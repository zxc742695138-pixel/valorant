**Cách dùng:** cược đội đang dẫn ≥ 3 round khi tổng round ≥ 17, **trừ khi đội đang dẫn nằm trong blacklist** (đội bị dẫn nằm trong blacklist thì vẫn cược).

- Dữ liệu: vlr.gg, 5 trận gần nhất của mỗi đội (mỗi trận gồm mọi map), tính đến 2026-11-08, chỉ trận giữa hai đội nhượng quyền; không tính giải khớp `Esports World Cup|Champions`
- Chỉ số: % map của đội kết thúc **13-11** (thắng hoặc thua) hoặc phải đá **hiệp phụ**
- **Blacklist** = 4 đội có tỉ lệ cao nhất mỗi khu vực

| Khu vực | Blacklist (tỉ lệ 13-11/OT, số map) | Thay đổi so với lần trước |
|---|---|---|
| Pacific | ZETA DIVISION 46% (6/13), Gen.G 43% (6/14), DetonatioN FocusMe 33% (4/12), FULL SENSE 29% (4/14) | không đổi |
| Americas | 100 Thieves 38% (5/13), Cloud9 25% (3/12), LOUD 24% (4/17), ENVY 15% (2/13) | không đổi |
| China | Bilibili Gaming 38% (5/13), Trace Esports 38% (5/13), All Gamers 31% (4/13), TYLOO 29% (4/14) | không đổi |

- 38 map của Esports World Cup 2026: China Qualifier (13/05–18/05) không có dữ liệu từng round trên vlr.gg nên không được tính.
- Bằng tỉ lệ với đội thứ 4 nhưng đá ít map hơn nên không vào blacklist — pacific: Rex Regum Qeon; americas: FURIA, Sentinels; china: Wolves Esports.

File `report-details.json` chứa tỉ lệ của cả 12 đội mỗi khu vực.
