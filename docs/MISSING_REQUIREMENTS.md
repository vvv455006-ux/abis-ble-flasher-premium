# Missing Technical Prerequisites - ABIS BLE FLASHER

The following items are required to fully activate the low-level Bluetooth firmware update functionality:

1. **Official Authentication Protocol**
   - Exact sequence for 3-phase handshake (PRE_COMM, SET_PWD, AUTH)
   - Key derivation method for AES-128 session
   - Nonce and MAC construction details

2. **Device Identification**
   - Reliable register addresses to read hardware ID / model after authentication
   - Confirmed name patterns or advertisement data for F3 vs G3

3. **Authorized IAP Firmware Update Procedure**
   - Exact command sequence for CMD_IAP_BEGIN (0x07), chunked writes, CRC verification
   - Chunk size, timeout and retry rules
   - Success/failure response codes from device

4. **Firmware Files**
   - Official or authorized firmware binaries for F3 and G3
   - SHA-256 (or documented) integrity hashes
   - Version compatibility matrix
   - Clear authorization to flash any third-party package (e.g. StarCFW encrypted blobs). Until then such packages remain `pending`/`blocked` and are not offered for update.

5. **Production Requirements**
   - HTTPS deployment
   - Secure session secret
   - Regular backup of SQLite database
   - Monitoring of admin logs

Until these are provided, the application provides full key/credit/admin/dashboard functionality and Bluetooth connection structure, with clear markers where official protocol integration is pending.
