## Cách cược

1. Chỉ xét map mà **cả hai đội đều nằm trong whitelist** (nhóm Một chiều) của khu vực mình — kể cả trận quốc tế giữa các khu vực.
2. Chờ tới lúc **tổng round của hai đội ≥ 17** và có một đội **dẫn đúng 3 round** → cược đội đang dẫn,
   **chỉ khi round vừa rồi do đội dẫn thắng** (9-7 → 10-7 thì cược; 10-6 → 10-7 thì bỏ).
3. Map có ít nhất một đội **không** nằm trong whitelist → bỏ.
4. Chỉ cược khi **tỉ lệ ăn từ khoảng 1.12 trở lên** (ăn 1.10 chưa có lãi trong backtest).

Ví dụ (Americas): ENVY vs KRÜ Esports → được cược đội dẫn trước; ENVY vs LOUD → bỏ (LOUD thuộc nhóm Giằng co).

## Danh sách

- Dữ liệu: vlr.gg, mùa 2026 (2026-01-01 → 2026-11-08), mọi giải, chỉ trận giữa hai đội nhượng quyền
- Chỉ số: % map của đội kết thúc **cách ≥ 4 round** (thắng đậm hoặc thua đậm)
- **Whitelist (Một chiều)** = 8/12 đội có tỉ lệ cao nhất mỗi khu vực; đội có dưới 10 map trong mùa chưa được xếp nhóm (không cược)

| Khu vực | Whitelist — Một chiều (% map đậm) | Giằng co | Thay đổi whitelist so với lần trước |
|---|---|---|---|
| Pacific | FULL SENSE 71%, Team Secret 70%, KIWOOM DRX 68%, T1 65%, DetonatioN FocusMe 63%, ZETA DIVISION 61%, Global Esports 61%, Paper Rex 59% | Nongshim RedForce 58%, Rex Regum Qeon 58%, Gen.G 56%, VARREL 43% | không đổi |
| Americas | ENVY 75%, KRÜ Esports 75%, FURIA 73%, LEVIATÁN 67%, Cloud9 67%, MIBR 66%, G2 Esports 65%, Evil Geniuses 65% | LOUD 65%, NRG 62%, Sentinels 61%, 100 Thieves 61% | không đổi |
| China | EDward Gaming 74%, Bilibili Gaming 73%, Dragon Ranger Gaming 71%, FunPlus Phoenix 70%, Xi Lai Gaming 70%, JD Gaming 69%, Nova Esports 69%, TYLOO 69% | All Gamers 68%, Wolves Esports 63%, Trace Esports 63%, Titan Esports Club 61% | không đổi |

- 43 map của Esports World Cup 2026: China Qualifier (12/05–18/05) không có dữ liệu từng round trên vlr.gg nên không được tính.

File `report-details.json` chứa số map thắng đậm / thua đậm của từng đội.
