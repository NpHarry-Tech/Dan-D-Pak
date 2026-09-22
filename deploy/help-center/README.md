# Help Center deployment

This standalone static stack serves `docs/help-center` behind the production
Caddy ingress network. It does not connect to the POS backend or database.

Expected remote layout:

```text
/opt/dandpak-help/
  docker-compose.yml
  nginx.conf
  current/
    index.html
    assets/help/{app.js,content.js,styles.css,screenshots/*}
```

The Caddy site uses `HELP_DOMAIN`; its default is the temporary preview host
`help.42.96.18.70.sslip.io`. Set `HELP_DOMAIN=help.dandpak.io.vn` only after its
DNS A/AAAA record points to the VPS.

