# Firmware library

Die 4 StarCFW-Firmware-ZIPs sind absichtlich NICHT in diesem Repo
(Binaries; per manuellem Upload / GitHub Release hinzufügen).

Korrekte Zuordnung (Display-Namen nur):

| Modell | Template | Datei | MD5 (ganze ZIP) |
|---|---|---|---|
| F3 Pro | Under Armour – Custom Display v3c | `StarCFW_custom_display_v3c_f3.zip` | `3736fd56399d919ded37322171749bd7` |
| F3 Pro | Smoke v0.6 | `StarCFW_v0.6_smoke_Abi_private_F3.zip` | `7e751f7af391832cb111b1283403ba52` |
| G3 Max | Stone Island – Smoke v0.6 | `StarCFW_v0.6_smoke_Abi_private_G3.zip` | `0351ba393702546f7f2f70faf30f9144` |
| G3 Max | Blackwave v0.1 | `StarCFW_v0.1_blackwave_G3.zip` | `1f448d7d64f1f868c65a9605395690d5` |

Jede ZIP enthält `FIRM.bin.enc` + `info.json`.
Vor dem Anbieten als `verified` müssen Herkunft, Integrität und
Modell-Kompatibilität geprüft werden – ein falsches Image brickt das Display.
Nie F3-Firmware auf ein G3-Gerät flashen und umgekehrt.
