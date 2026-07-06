import urllib.request
import urllib.error
import bs4
import json
import time
import sys

sys.stdout.reconfigure(encoding='utf-8')

def crawl_page(p):
    url = f"https://www.danonfoods.com/vn/san-pham.html/p-{p}"
    print(f"Crawling page {p}: {url} ...")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        html = urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:
        print(f"Error crawling page {p}: {e}")
        return []
    
    soup = bs4.BeautifulSoup(html, 'html.parser')
    cards = soup.find_all('div', class_='wrap_product')
    items = []
    for card in cards:
        img_tag = card.find('div', class_='img')
        title_tag = card.find('div', class_='i-title')
        if not img_tag or not title_tag:
            continue
        
        img = img_tag.find('img')
        title_link = title_tag.find('a')
        if not img or not title_link:
            continue
        
        title = title_link.get_text(strip=True)
        img_url = img.get('src')
        if not img_url:
            continue
        
        # Absolute URL
        if img_url.startswith('/'):
            img_url = "https://www.danonfoods.com" + img_url
        
        # Convert thumbnail to full-res
        full_res_url = img_url
        if '/thumbs/250_' in img_url:
            full_res_url = img_url.replace('/thumbs/250_', '/')
            
        items.append({
            "title": title,
            "img_url": full_res_url,
            "source_url": title_link.get('href')
        })
    print(f"Found {len(items)} items on page {p}")
    return items

def main():
    all_items = []
    # Loop from page 1 to 50
    for p in range(1, 51):
        items = crawl_page(p)
        if not items and p > 10:
            # If we hit multiple consecutive empty pages after page 10, stop
            # (but page 49 is known to exist)
            pass
        all_items.extend(items)
        time.sleep(0.5) # Be polite
        
    # De-duplicate by title
    unique_items = {}
    for item in all_items:
        unique_items[item['title']] = item
        
    result = list(unique_items.values())
    print(f"\nCrawling complete. Total unique items found: {len(result)}")
    
    with open('server/scripts/danon_crawled_images.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print("Saved to server/scripts/danon_crawled_images.json")

if __name__ == '__main__':
    main()
