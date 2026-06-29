// dandpak-hw-agent — Local hardware bridge for Dan D Pak POS/ERP (Windows).
//
// WHY THIS EXISTS
//   Thermal printers connected over LAN (TCP 9100) are already driven directly by
//   the Node server at native speed, so they do NOT go through this agent.
//   This agent exists for USB / locally-attached Windows printers: it sends RAW
//   ESC/POS bytes straight to the device (cut paper, kick cash drawer, column
//   layout all work), instead of the slow "print plain text via OS driver" path.
//
// DESIGN
//   - Zero external dependencies. Pure Win32 + Winsock2 + Winspool.
//   - Compiles with MSVC (cl) or MinGW-w64 (g++). See build.bat / build-mingw.bat.
//   - Tiny HTTP/1.1 server bound to 127.0.0.1 ONLY (never reachable from the LAN).
//   - Optional shared-secret token (env HW_AGENT_TOKEN) checked on every mutating
//     route, to stop other local processes from poking the agent.
//
// ROUTES
//   GET  /health              -> {"ok":true,...}
//   GET  /printers            -> [{"name":"...","status":N}, ...]   (token required)
//   POST /print   {printer, dataBase64}   -> RAW print bytes        (token required)
//   POST /drawer  {printer}               -> ESC/POS drawer kick    (token required)
//
// Build (MinGW):  g++ -std=c++17 -O2 src/main.cpp -o dandpak-hw-agent.exe -lws2_32 -lwinspool
// Build (MSVC) :  cl /EHsc /std:c++17 src\main.cpp /Fe:dandpak-hw-agent.exe ws2_32.lib winspool.lib

#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <winspool.h>

#include <string>
#include <vector>
#include <thread>
#include <cstdio>
#include <cstdlib>
#include <cstring>

#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "winspool.lib")

static const char* AGENT_VERSION = "1.0.0";

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

static std::string getenvStr(const char* name) {
    char buf[1024];
    size_t len = 0;
    if (getenv_s(&len, buf, sizeof(buf), name) == 0 && len > 0) {
        return std::string(buf, len > 0 ? len - 1 : 0); // getenv_s len includes NUL
    }
    return std::string();
}

// JSON string escaping for our (small) responses.
static std::string jsonStr(const std::string& s) {
    std::string out = "\"";
    for (char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if ((unsigned char)c < 0x20) { char b[8]; sprintf_s(b, "\\u%04x", c); out += b; }
                else out += c;
        }
    }
    out += "\"";
    return out;
}

// Extract a JSON string value by key from a flat object. Good enough for our
// tiny, server-generated payloads (printer name + base64). Handles \" and \\.
static bool jsonGetString(const std::string& body, const std::string& key, std::string& out) {
    std::string needle = "\"" + key + "\"";
    size_t k = body.find(needle);
    if (k == std::string::npos) return false;
    size_t colon = body.find(':', k + needle.size());
    if (colon == std::string::npos) return false;
    size_t q = body.find('"', colon + 1);
    if (q == std::string::npos) return false;
    out.clear();
    for (size_t i = q + 1; i < body.size(); ++i) {
        char c = body[i];
        if (c == '\\' && i + 1 < body.size()) {
            char n = body[++i];
            switch (n) {
                case 'n': out += '\n'; break;
                case 'r': out += '\r'; break;
                case 't': out += '\t'; break;
                default:  out += n;    break;
            }
        } else if (c == '"') {
            return true;
        } else {
            out += c;
        }
    }
    return false;
}

// Base64 decode (standard alphabet). Returns false on hard errors.
static bool base64Decode(const std::string& in, std::vector<unsigned char>& out) {
    static int T[256];
    static bool init = false;
    if (!init) {
        for (int i = 0; i < 256; ++i) T[i] = -1;
        const char* a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        for (int i = 0; i < 64; ++i) T[(unsigned char)a[i]] = i;
        init = true;
    }
    int val = 0, bits = 0;
    out.clear();
    for (unsigned char c : in) {
        if (c == '=' ) break;
        if (c == '\n' || c == '\r' || c == ' ') continue;
        int d = T[c];
        if (d < 0) return false;
        val = (val << 6) | d;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back((unsigned char)((val >> bits) & 0xFF));
        }
    }
    return true;
}

// ----------------------------------------------------------------------------
// Printing (RAW ESC/POS via the Windows print API)
// ----------------------------------------------------------------------------

static bool printRaw(const std::string& printerName, const std::vector<unsigned char>& data, std::string& err) {
    HANDLE hPrinter = NULL;
    if (!OpenPrinterA((LPSTR)printerName.c_str(), &hPrinter, NULL)) {
        err = "OpenPrinter failed for '" + printerName + "' (err " + std::to_string(GetLastError()) + ")";
        return false;
    }
    DOC_INFO_1A di;
    di.pDocName = (LPSTR)"Dan D Pak POS";
    di.pOutputFile = NULL;
    di.pDatatype = (LPSTR)"RAW"; // passthrough: no driver re-rendering of our bytes
    DWORD jobId = StartDocPrinterA(hPrinter, 1, (LPBYTE)&di);
    if (jobId == 0) {
        err = "StartDocPrinter failed (err " + std::to_string(GetLastError()) + ")";
        ClosePrinter(hPrinter);
        return false;
    }
    bool ok = true;
    if (!StartPagePrinter(hPrinter)) { ok = false; err = "StartPagePrinter failed"; }
    if (ok) {
        DWORD written = 0;
        if (!WritePrinter(hPrinter, (LPVOID)data.data(), (DWORD)data.size(), &written) || written != data.size()) {
            ok = false; err = "WritePrinter incomplete";
        }
        EndPagePrinter(hPrinter);
    }
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return ok;
}

static std::string listPrintersJson() {
    DWORD needed = 0, returned = 0;
    DWORD flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    EnumPrintersA(flags, NULL, 2, NULL, 0, &needed, &returned);
    if (needed == 0) return "[]";
    std::vector<unsigned char> buf(needed);
    if (!EnumPrintersA(flags, NULL, 2, buf.data(), needed, &needed, &returned)) return "[]";
    PRINTER_INFO_2A* pi = (PRINTER_INFO_2A*)buf.data();
    std::string out = "[";
    for (DWORD i = 0; i < returned; ++i) {
        if (i) out += ",";
        std::string name = pi[i].pPrinterName ? pi[i].pPrinterName : "";
        out += "{\"name\":" + jsonStr(name) + ",\"status\":" + std::to_string(pi[i].Status) + "}";
    }
    out += "]";
    return out;
}

// ESC/POS cash drawer kick (pin 2, same sequence the Node server uses).
static const unsigned char DRAWER_KICK[] = { 0x1B, 0x70, 0x00, 0x19, 0xFA };

// ----------------------------------------------------------------------------
// Minimal HTTP/1.1 server (loopback only)
// ----------------------------------------------------------------------------

struct HttpRequest {
    std::string method;
    std::string path;
    std::string body;
    std::string token; // X-HW-Token header
};

static std::string headerValue(const std::string& headers, const std::string& nameLower) {
    // headers is the raw block; do a case-insensitive line search.
    size_t pos = 0;
    while (pos < headers.size()) {
        size_t eol = headers.find("\r\n", pos);
        if (eol == std::string::npos) eol = headers.size();
        std::string line = headers.substr(pos, eol - pos);
        size_t colon = line.find(':');
        if (colon != std::string::npos) {
            std::string k = line.substr(0, colon);
            for (auto& c : k) c = (char)tolower((unsigned char)c);
            if (k == nameLower) {
                size_t v = colon + 1;
                while (v < line.size() && (line[v] == ' ' || line[v] == '\t')) ++v;
                return line.substr(v);
            }
        }
        pos = eol + 2;
    }
    return std::string();
}

static void sendResponse(SOCKET c, int status, const char* statusText, const std::string& json) {
    std::string resp = "HTTP/1.1 " + std::to_string(status) + " " + statusText + "\r\n";
    resp += "Content-Type: application/json; charset=utf-8\r\n";
    resp += "Connection: close\r\n";
    resp += "Content-Length: " + std::to_string(json.size()) + "\r\n\r\n";
    resp += json;
    send(c, resp.c_str(), (int)resp.size(), 0);
}

static void handleClient(SOCKET c, std::string expectedToken) {
    std::string buf;
    char tmp[4096];
    size_t headerEnd = std::string::npos;
    size_t contentLength = 0;
    bool haveHeaders = false;

    // Read until we have full headers, then full body.
    for (;;) {
        if (!haveHeaders) {
            headerEnd = buf.find("\r\n\r\n");
            if (headerEnd != std::string::npos) {
                haveHeaders = true;
                std::string head = buf.substr(0, headerEnd);
                std::string cl = headerValue(head, "content-length");
                contentLength = cl.empty() ? 0 : (size_t)strtoul(cl.c_str(), NULL, 10);
            }
        }
        if (haveHeaders) {
            size_t have = buf.size() - (headerEnd + 4);
            if (have >= contentLength) break;
        }
        int n = recv(c, tmp, sizeof(tmp), 0);
        if (n <= 0) break;
        buf.append(tmp, n);
        if (buf.size() > 64 * 1024 * 1024) break; // 64MB hard cap
    }

    HttpRequest req;
    if (headerEnd != std::string::npos) {
        std::string head = buf.substr(0, headerEnd);
        size_t sp1 = head.find(' ');
        size_t sp2 = head.find(' ', sp1 + 1);
        if (sp1 != std::string::npos && sp2 != std::string::npos) {
            req.method = head.substr(0, sp1);
            req.path = head.substr(sp1 + 1, sp2 - sp1 - 1);
        }
        req.token = headerValue(head, "x-hw-token");
        req.body = buf.substr(headerEnd + 4, contentLength);
    }

    // /health is always open (used for liveness probing).
    if (req.method == "GET" && req.path == "/health") {
        std::string j = std::string("{\"ok\":true,\"agent\":\"dandpak-hw\",\"version\":\"") + AGENT_VERSION + "\"}";
        sendResponse(c, 200, "OK", j);
        closesocket(c);
        return;
    }

    // Everything else requires the token (if one is configured).
    if (!expectedToken.empty() && req.token != expectedToken) {
        sendResponse(c, 401, "Unauthorized", "{\"ok\":false,\"error\":\"bad or missing X-HW-Token\"}");
        closesocket(c);
        return;
    }

    if (req.method == "GET" && req.path == "/printers") {
        sendResponse(c, 200, "OK", listPrintersJson());
    } else if (req.method == "POST" && req.path == "/print") {
        std::string printer, b64;
        if (!jsonGetString(req.body, "printer", printer) || printer.empty()) {
            sendResponse(c, 400, "Bad Request", "{\"ok\":false,\"error\":\"missing printer\"}");
        } else if (!jsonGetString(req.body, "dataBase64", b64)) {
            sendResponse(c, 400, "Bad Request", "{\"ok\":false,\"error\":\"missing dataBase64\"}");
        } else {
            std::vector<unsigned char> bytes;
            if (!base64Decode(b64, bytes)) {
                sendResponse(c, 400, "Bad Request", "{\"ok\":false,\"error\":\"bad base64\"}");
            } else {
                std::string err;
                if (printRaw(printer, bytes, err))
                    sendResponse(c, 200, "OK", "{\"ok\":true,\"bytes\":" + std::to_string(bytes.size()) + "}");
                else
                    sendResponse(c, 500, "Internal Server Error", "{\"ok\":false,\"error\":" + jsonStr(err) + "}");
            }
        }
    } else if (req.method == "POST" && req.path == "/drawer") {
        std::string printer;
        if (!jsonGetString(req.body, "printer", printer) || printer.empty()) {
            sendResponse(c, 400, "Bad Request", "{\"ok\":false,\"error\":\"missing printer\"}");
        } else {
            std::vector<unsigned char> bytes(DRAWER_KICK, DRAWER_KICK + sizeof(DRAWER_KICK));
            std::string err;
            if (printRaw(printer, bytes, err))
                sendResponse(c, 200, "OK", "{\"ok\":true}");
            else
                sendResponse(c, 500, "Internal Server Error", "{\"ok\":false,\"error\":" + jsonStr(err) + "}");
        }
    } else {
        sendResponse(c, 404, "Not Found", "{\"ok\":false,\"error\":\"unknown route\"}");
    }
    closesocket(c);
}

int main() {
    std::string token = getenvStr("HW_AGENT_TOKEN");
    std::string portStr = getenvStr("HW_AGENT_PORT");
    unsigned short port = (unsigned short)(portStr.empty() ? 39041 : atoi(portStr.c_str()));
    if (port == 0) port = 39041;

    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {
        fprintf(stderr, "[hw-agent] WSAStartup failed\n");
        return 1;
    }

    SOCKET listenSock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listenSock == INVALID_SOCKET) { fprintf(stderr, "[hw-agent] socket() failed\n"); return 1; }

    BOOL reuse = TRUE;
    setsockopt(listenSock, SOL_SOCKET, SO_REUSEADDR, (const char*)&reuse, sizeof(reuse));

    sockaddr_in addr;
    memset(&addr, 0, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(port);
    inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr); // loopback ONLY — never the LAN

    if (bind(listenSock, (sockaddr*)&addr, sizeof(addr)) == SOCKET_ERROR) {
        fprintf(stderr, "[hw-agent] bind 127.0.0.1:%u failed (err %d) — already running?\n", port, WSAGetLastError());
        return 1;
    }
    if (listen(listenSock, SOMAXCONN) == SOCKET_ERROR) {
        fprintf(stderr, "[hw-agent] listen failed\n");
        return 1;
    }

    fprintf(stdout, "[hw-agent] dandpak-hw-agent v%s listening on http://127.0.0.1:%u (token %s)\n",
            AGENT_VERSION, port, token.empty() ? "DISABLED — loopback only" : "enabled");
    fflush(stdout);

    for (;;) {
        SOCKET client = accept(listenSock, NULL, NULL);
        if (client == INVALID_SOCKET) continue;
        DWORD timeout = 8000;
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, (const char*)&timeout, sizeof(timeout));
        setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, (const char*)&timeout, sizeof(timeout));
        std::thread(handleClient, client, token).detach();
    }

    closesocket(listenSock);
    WSACleanup();
    return 0;
}
