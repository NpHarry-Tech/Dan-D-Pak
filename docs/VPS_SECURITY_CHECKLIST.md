# VPS Security Checklist

Last updated: 2026-06-18

- UFW enabled.
- SSH key login recommended.
- Password SSH disabled where possible.
- Database port not exposed publicly.
- Redis port not exposed publicly.
- HTTPS enabled.
- `.env` not committed.
- Strong admin passwords/PIN policies reviewed.
- Service-role keys protected on backend only.
- Database backups enabled and tested.
- Logs available and rotated.
- Restart policy enabled.
- CORS restricted to known domains.
- Reverse proxy forwards only required paths.
- Upload/private storage not served publicly by accident.
- Health endpoint exposes provider modes but no secrets.
