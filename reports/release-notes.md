**Cách dùng:** chỉ cược map khi **cả hai đội đều nằm trong whitelist** (kể cả trận quốc tế giữa các khu vực). Cược đội đang dẫn ≥ 3 round khi tổng round ≥ 17.

- Dữ liệu: vlr.gg, 90 ngày gần nhất (2026-08-07 → 2026-11-05), chỉ trận giữa hai đội nhượng quyền
- Lật được: bị dẫn ≥ 3 round khi tổng round ≥ 17 nhưng thắng map. Bị lật: dẫn như vậy nhưng thua map
- **Whitelist** = nhóm Trung bình: |lật được − bị lật| < 1 và lật được + bị lật < 3
- **Blacklist** = các đội còn lại: Mạnh (lật được − bị lật ≥ +1), Yếu (≤ −1), Không ổn định (lật được + bị lật ≥ 3)

| Khu vực | Whitelist | Blacklist | Thay đổi whitelist so với lần trước |
|---|---|---|---|
| Pacific | Gen.G, VARREL, ZETA DIVISION, DetonatioN FocusMe, Rex Regum Qeon, Team Secret, FULL SENSE | T1 (Mạnh), Global Esports (Mạnh), Nongshim RedForce (Mạnh), Paper Rex (Yếu), KIWOOM DRX (Yếu) | — |
| Americas | LEVIATÁN, MIBR, Evil Geniuses, Sentinels, Cloud9, FURIA, KRÜ Esports | NRG (Mạnh), 100 Thieves (Mạnh), ENVY (Mạnh), LOUD (Không ổn định), G2 Esports (Yếu) | — |
| China | Trace Esports, Titan Esports Club, EDward Gaming, FunPlus Phoenix, Wolves Esports | TYLOO (Mạnh), Nova Esports (Mạnh), All Gamers (Yếu), Bilibili Gaming (Yếu), Xi Lai Gaming (Yếu), Dragon Ranger Gaming (Yếu), JD Gaming (Yếu) | — |

File `report-details.json` chứa số lần lật được / bị lật của từng đội.
