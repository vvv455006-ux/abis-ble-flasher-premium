# ABIS BLE FLASHER

> Hinweis zu diesem Stand (2026-11-08): Dies ist ein separates Projekt neben
> Abix Flasher v2 (`abix-flasher-Public` / abi.lpxtech.de) und ersetzt es nicht.
> Der Flash-Vorgang hier ist simuliert (Timer auf 100% in
> `frontend/public/js/app.js`, danach wird 1 Credit abgezogen) – kein enc2,
> kein echter IAP-Transfer, keine Modell-/Batterie-/Checksummen-Prüfung.
> Siehe auch `docs/MISSING_REQUIREMENTS.md`.
> Die Datenbank `database/abis.json` (mit Admin-Hash) ist nicht im Repo – sie
> wird beim ersten Start neu erzeugt, Admin-Key per `ADMIN_KEY` in `.env`.
> `database/init.js` ist ungenutzter Alt-Code (braucht `better-sqlite3`, das
> nicht in `package.json` steht); der Server nutzt `database/db.js` (JSON-Datei).

Professional firmware management platform for compatible Segway F3 and G3 devices.

## Features

- Secure Access Key login with credit system
- Admin panel for key generation, management, statistics and audit logs
- Main dashboard with device status, credits, Bluetooth controls
- Web Bluetooth device detection (using documented Ninebot service UUID)
- Firmware library (verified templates only)
- Flash Center with progress tracking
- Credit deduction **only** after fully verified successful update (server-side atomic)
- Flash history
- Responsive premium dark UI

## Important Technical Notes

**Bluetooth & Firmware Protocol**

The application implements connection via the publicly documented Ninebot Custom BLE service:

- Service: `6e400001-0000-0000-006e-696e65626f74`
- Write: `6e400002-0000-0000-006e-696e65626f74`
- Notify: `6e400004-0000-0000-006e-696e65626f74`

Full device identification (beyond name matching) and the actual IAP firmware update sequence require:

1. Completed 3-phase authentication handshake
2. Encrypted AES-128 session
3. Official authorized IAP commands (BEGIN / WRITE chunks / CRC)
4. Verified firmware binaries with integrity hashes

**These steps are structured in the code but not fully active.** Official technical specifications from the manufacturer or authorized update procedure must be provided to complete the low-level implementation. No speed locks, safety functions or manufacturer protections are bypassed.

Reference packages may be present under `firmware/library/` (including third-party StarCFW archives containing encrypted `FIRM.bin.enc` + `info.json`). These are **not** treated as verified or authorized by default.

Admin must explicitly review integrity, origin, and compatibility and only then set `compatibility_status = verified`. The Flash Center only offers firmware marked verified. Encrypted third-party CFW packages require an authorized decryption/update path that is **not** implemented here.

## Installation

1. Install Node.js 18+
2. Clone or copy this project
3. `cd abis-ble-flasher`
4. `npm install`
5. Copy `.env.example` to `.env` and change `SESSION_SECRET` and `ADMIN_KEY`
6. `npm start`

Default admin key is printed on first start (or set via `ADMIN_KEY`).

**Web Bluetooth requires HTTPS** (or localhost). Deploy behind reverse proxy with TLS for production use.

## Database

SQLite database is auto-created in `database/abis.db` on first run with all required tables.

## Missing Technical Prerequisites

- Official Segway/Ninebot technical documentation for F3/G3 BLE authentication and IAP firmware update protocol
- Verified official or authorized firmware binary files with known integrity hashes
- Confirmation of exact model identification registers after authentication
- Production HTTPS certificate
- Optional: Hardware testing with real F3/G3 devices

## Security

- Access keys stored as bcrypt hashes
- Credits and permissions checked server-side
- Atomic credit deduction
- Rate limiting
- Session cookies httpOnly
- Admin actions logged
- Helmet security headers

## License

Internal / Commercial use only. Not for unauthorized device modification.
