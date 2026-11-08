## Cách cược

1. Chỉ xét map mà **cả hai đội đều nằm trong whitelist** (nhóm Một chiều) của khu vực mình — kể cả trận quốc tế giữa các khu vực.
2. Chờ tới lúc **tổng round của hai đội ≥ 17** và có một đội **dẫn ≥ 3 round** → cược đội đang dẫn.
3. Map có ít nhất một đội **không** nằm trong whitelist → bỏ.
4. Chỉ cược khi **tỉ lệ ăn từ khoảng 1.12 trở lên** (ăn 1.10 chưa có lãi trong backtest).

Ví dụ (Americas): KRÜ Esports vs ENVY → được cược đội dẫn trước; KRÜ Esports vs MIBR → bỏ (MIBR thuộc nhóm Giằng co).

## Danh sách

- Dữ liệu: vlr.gg, mùa 2026 (2026-01-01 → 2026-11-08), mọi giải, chỉ trận giữa hai đội nhượng quyền
- Chỉ số: % map của đội kết thúc **cách ≥ 4 round** (thắng đậm hoặc thua đậm)
- **Whitelist (Một chiều)** = 8/12 đội có tỉ lệ cao nhất mỗi khu vực; đội có dưới 10 map trong mùa chưa được xếp nhóm (không cược)

| Khu vực | Whitelist — Một chiều (% map đậm) | Giằng co | Thay đổi whitelist so với lần trước |
|---|---|---|---|
| Pacific | Team Secret 73%, KIWOOM DRX 70%, Rex Regum Qeon 67%, Global Esports 61%, FULL SENSE 60%, DetonatioN FocusMe 59%, T1 58%, Nongshim RedForce 57% | Paper Rex 55%, Gen.G 54%, VARREL 50%, ZETA DIVISION 47% | — |
| Americas | KRÜ Esports 82%, ENVY 79%, FURIA 75%, Evil Geniuses 75%, Sentinels 74%, Cloud9 71%, LEVIATÁN 70%, LOUD 68% | MIBR 67%, NRG 63%, 100 Thieves 63%, G2 Esports 59% | — |
| China | Nova Esports 76%, Bilibili Gaming 70%, TYLOO 69%, Xi Lai Gaming 68%, Dragon Ranger Gaming 68%, FunPlus Phoenix 68%, EDward Gaming 68%, All Gamers 62% | JD Gaming 62%, Trace Esports 61%, Titan Esports Club 58%, Wolves Esports 54% | — |

- 38 map của Esports World Cup 2026: China Qualifier (13/05–18/05) không có dữ liệu từng round trên vlr.gg nên không được tính.

File `report-details.json` chứa số map thắng đậm / thua đậm của từng đội.
