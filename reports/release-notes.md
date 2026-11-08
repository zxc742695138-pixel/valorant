## Cách cược

1. Chờ tới lúc **tổng round của hai đội ≥ 17** và có một đội **dẫn ≥ 3 round**.
2. Xem **đội đang dẫn** có trong blacklist của khu vực nó không:
   - **Có** → bỏ, không cược map này.
   - **Không** → cược đội đang dẫn, **kể cả khi đội bị dẫn nằm trong blacklist**.
3. **Không cược** các giải EWC, vòng loại EWC và Champions.
4. Chỉ cược khi **tỉ lệ ăn từ khoảng 1.12 trở lên** (ăn 1.10 là lỗ trong backtest).

Ví dụ (Americas: 100 Thieves, Cloud9, LOUD, ENVY, FURIA): 100 Thieves dẫn Sentinels 10-7 → không cược; Sentinels dẫn 100 Thieves 10-7 → cược Sentinels.

## Danh sách

- Dữ liệu: vlr.gg, 5 trận gần nhất của mỗi đội (mỗi trận gồm mọi map), tính đến 2026-11-08, chỉ trận giữa hai đội nhượng quyền; không tính giải khớp `Esports World Cup|Champions`
- Chỉ số: % map của đội kết thúc **13-11** (thắng hoặc thua) hoặc phải đá **hiệp phụ**
- **Blacklist** = 5 đội có tỉ lệ cao nhất mỗi khu vực (bằng tỉ lệ: đội đá nhiều map hơn xếp trên)

| Khu vực | Blacklist (tỉ lệ 13-11/OT, số map) | Thay đổi so với lần trước |
|---|---|---|
| Pacific | ZETA DIVISION 46% (6/13), Gen.G 43% (6/14), DetonatioN FocusMe 33% (4/12), FULL SENSE 29% (4/14), Rex Regum Qeon 29% (4/14) | vào: Rex Regum Qeon |
| Americas | 100 Thieves 38% (5/13), Cloud9 25% (3/12), LOUD 24% (4/17), ENVY 15% (2/13), FURIA 15% (2/13) | vào: FURIA |
| China | Bilibili Gaming 38% (5/13), Trace Esports 38% (5/13), All Gamers 31% (4/13), TYLOO 29% (4/14), Wolves Esports 29% (4/14) | vào: Wolves Esports |

- 38 map của Esports World Cup 2026: China Qualifier (13/05–18/05) không có dữ liệu từng round trên vlr.gg nên không được tính.
- Bằng tỉ lệ với đội thứ 5 nhưng đá ít map hơn nên không vào blacklist — americas: Sentinels.

File `report-details.json` chứa tỉ lệ của cả 12 đội mỗi khu vực.
