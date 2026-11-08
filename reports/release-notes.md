**Cách dùng:** không cược map có đội nằm trong blacklist. Cược đội đang dẫn ≥ 3 round khi tổng round ≥ 17.

- Dữ liệu: vlr.gg, 90 ngày gần nhất (2026-08-10 → 2026-11-08), chỉ trận giữa hai đội nhượng quyền; không tính giải khớp `Esports World Cup|Champions`
- Chỉ số: % map của đội kết thúc **13-11** (thắng hoặc thua) hoặc phải đá **hiệp phụ**
- **Blacklist** = 4 đội có tỉ lệ cao nhất mỗi khu vực

| Khu vực | Blacklist (tỉ lệ 13-11/OT, số map) | Thay đổi so với lần trước |
|---|---|---|
| Pacific | Gen.G 40% (2/5), ZETA DIVISION 40% (2/5), KIWOOM DRX 38% (3/8), Rex Regum Qeon 33% (1/3) | không đổi |
| Americas | 100 Thieves 33% (3/9), Cloud9 33% (1/3), LOUD 21% (4/19), Evil Geniuses 17% (2/12) | không đổi |
| China | Trace Esports 45% (5/11), Bilibili Gaming 38% (5/13), All Gamers 31% (4/13), Dragon Ranger Gaming 27% (3/11) | không đổi |

- 38 map của Esports World Cup 2026: China Qualifier (13/05–18/05) không có dữ liệu từng round trên vlr.gg nên không được tính.
- Đội có dưới 5 map trong kỳ (số liệu ít, tỉ lệ dễ dao động): Rex Regum Qeon (3), DetonatioN FocusMe (4), Team Secret (2), Cloud9 (3), Sentinels (4), Wolves Esports (0).

File `report-details.json` chứa tỉ lệ của cả 12 đội mỗi khu vực.
