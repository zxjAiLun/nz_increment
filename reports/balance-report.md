# Balance Report

Generated from source formulas. Points: 144

## Guardrail Summary

- Status: warn
- Failed: false
- Fails: 0
- Warnings: 6

## Findings

| 状态 | 原因 | 推荐关注 | 难度 | 构筑 | 场景 | 说明 |
|---|---|---|---:|---|---|---|
| warn | luck_income_out_of_band | combatPowerTradeoff | 10 | luck | normal | 幸运流普通怪金币/分钟应比均衡流高 10%-40%，当前为 250%。 |
| warn | luck_income_out_of_band | combatPowerTradeoff | 50 | luck | normal | 幸运流普通怪金币/分钟应比均衡流高 10%-40%，当前为 240%。 |
| warn | luck_income_out_of_band | combatPowerTradeoff | 100 | luck | normal | 幸运流普通怪金币/分钟应比均衡流高 10%-40%，当前为 277%。 |
| warn | luck_income_out_of_band | combatPowerTradeoff | 200 | luck | normal | 幸运流普通怪金币/分钟应比均衡流高 10%-40%，当前为 263%。 |
| warn | luck_income_out_of_band | combatPowerTradeoff | 500 | luck | normal | 幸运流普通怪金币/分钟应比均衡流高 10%-40%，当前为 474%。 |
| warn | luck_income_out_of_band | combatPowerTradeoff | 1000 | luck | normal | 幸运流普通怪金币/分钟应比均衡流高 10%-40%，当前为 439%。 |

## Balance Matrix

| 难度 | 构筑 | 场景 | 状态 | 胜率 | 平均TTK | 平均TTL | 死亡率 | 金币/分钟 | 装备/分钟 | 技能/分钟 | 技能伤害占比 | 30分钟成长 | 主要失败原因 | 推荐关注 |
|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 10 | balanced | normal | pass | 100.0% | 2.5s | 2.5s | 0.0% | 673 | 12.00 | 24.00 | 100.0% | 306404 | none | none |
| 10 | balanced | boss | pass | 100.0% | 6.8s | 6.8s | 0.0% | 739 | 2.05 | 25.76 | 82.8% | 1322346 | none | none |
| 10 | balanced | highDefenseBoss | pass | 100.0% | 7.7s | 7.7s | 0.0% | 652 | 2.32 | 25.55 | 84.2% | 1258997 | none | none |
| 10 | balanced | highDodgeBoss | pass | 100.0% | 6.9s | 6.9s | 0.0% | 730 | 2.31 | 26.31 | 86.2% | 1915465 | none | none |
| 10 | crit | normal | pass | 100.0% | 2.5s | 2.5s | 0.0% | 673 | 7.20 | 26.40 | 100.0% | 184004 | none | none |
| 10 | crit | boss | pass | 100.0% | 4.2s | 4.2s | 0.0% | 1212 | 5.28 | 27.84 | 96.8% | 2096647 | none | none |
| 10 | crit | highDefenseBoss | pass | 100.0% | 3.8s | 3.8s | 0.0% | 1318 | 4.17 | 27.65 | 98.1% | 2725521 | none | none |
| 10 | crit | highDodgeBoss | pass | 100.0% | 5.2s | 5.2s | 0.0% | 978 | 4.26 | 27.48 | 98.2% | 2139567 | none | none |
| 10 | tank | normal | pass | 100.0% | 2.5s | 2.5s | 0.0% | 673 | 7.20 | 24.00 | 100.0% | 192644 | none | none |
| 10 | tank | boss | pass | 100.0% | 15.3s | 15.3s | 0.0% | 329 | 0.78 | 18.39 | 46.7% | 559685 | none | none |
| 10 | tank | highDefenseBoss | pass | 100.0% | 19.3s | 19.3s | 0.0% | 262 | 1.04 | 16.94 | 40.7% | 624718 | none | none |
| 10 | tank | highDodgeBoss | pass | 100.0% | 17.8s | 17.8s | 0.0% | 283 | 1.35 | 17.50 | 45.5% | 547639 | none | none |
| 10 | armor | normal | pass | 100.0% | 2.5s | 2.5s | 0.0% | 673 | 6.40 | 24.80 | 100.0% | 175124 | none | none |
| 10 | armor | boss | pass | 100.0% | 3.0s | 3.0s | 0.0% | 1684 | 4.67 | 33.33 | 99.5% | 2760010 | none | none |
| 10 | armor | highDefenseBoss | pass | 100.0% | 2.8s | 2.8s | 0.0% | 1783 | 11.29 | 31.76 | 100.0% | 3274952 | none | none |
| 10 | armor | highDodgeBoss | pass | 100.0% | 4.0s | 4.0s | 0.0% | 1263 | 4.50 | 32.50 | 96.4% | 3114308 | none | none |
| 10 | speedSkill | normal | pass | 100.0% | 1.4s | 1.4s | 0.0% | 1203 | 12.86 | 42.86 | 100.0% | 328579 | none | none |
| 10 | speedSkill | boss | pass | 100.0% | 1.6s | 1.6s | 0.0% | 3092 | 18.37 | 62.45 | 100.0% | 8219774 | none | none |
| 10 | speedSkill | highDefenseBoss | pass | 100.0% | 1.5s | 1.5s | 0.0% | 3382 | 18.75 | 75.00 | 100.0% | 6198369 | none | none |
| 10 | speedSkill | highDodgeBoss | pass | 100.0% | 1.6s | 1.6s | 0.0% | 3183 | 11.34 | 64.29 | 99.2% | 4815397 | none | none |
| 10 | luck | normal | warn | 100.0% | 2.7s | 2.7s | 0.0% | 1681 | 11.21 | 26.90 | 91.9% | 286812 | luck_income_out_of_band | combatPowerTradeoff |
| 10 | luck | boss | pass | 100.0% | 7.8s | 7.8s | 0.0% | 1735 | 4.37 | 22.89 | 50.4% | 1163364 | none | none |
| 10 | luck | highDefenseBoss | pass | 100.0% | 10.4s | 10.4s | 0.0% | 1302 | 3.47 | 21.04 | 52.2% | 1535153 | none | none |
| 10 | luck | highDodgeBoss | pass | 100.0% | 9.2s | 9.2s | 0.0% | 1465 | 3.26 | 21.06 | 46.9% | 1020901 | none | none |
| 50 | balanced | normal | pass | 100.0% | 2.2s | 2.2s | 0.0% | 1438 | 11.06 | 29.49 | 97.9% | 282890 | none | none |
| 50 | balanced | boss | pass | 100.0% | 5.2s | 5.2s | 0.0% | 1783 | 4.19 | 28.95 | 81.9% | 2144498 | none | none |
| 50 | balanced | highDefenseBoss | pass | 100.0% | 6.5s | 6.5s | 0.0% | 1438 | 2.76 | 33.18 | 85.5% | 2410540 | none | none |
| 50 | balanced | highDodgeBoss | pass | 100.0% | 5.8s | 5.8s | 0.0% | 1611 | 4.48 | 31.67 | 84.9% | 2270123 | none | none |
| 50 | crit | normal | pass | 100.0% | 2.3s | 2.3s | 0.0% | 1351 | 12.12 | 29.44 | 99.6% | 309901 | none | none |
| 50 | crit | boss | pass | 100.0% | 2.6s | 2.6s | 0.0% | 3614 | 8.49 | 30.12 | 98.8% | 3746493 | none | none |
| 50 | crit | highDefenseBoss | pass | 100.0% | 2.9s | 2.9s | 0.0% | 3261 | 8.36 | 28.57 | 98.0% | 2904535 | none | none |
| 50 | crit | highDodgeBoss | pass | 100.0% | 3.3s | 3.3s | 0.0% | 2845 | 7.29 | 29.18 | 97.7% | 4569002 | none | none |
| 50 | tank | normal | pass | 100.0% | 2.9s | 2.9s | 0.0% | 1087 | 9.06 | 27.87 | 82.4% | 231663 | none | none |
| 50 | tank | boss | pass | 100.0% | 12.0s | 12.0s | 0.0% | 779 | 2.00 | 21.97 | 44.7% | 908806 | none | none |
| 50 | tank | highDefenseBoss | pass | 100.0% | 17.5s | 17.5s | 0.0% | 534 | 1.14 | 18.36 | 37.9% | 598747 | none | none |
| 50 | tank | highDodgeBoss | pass | 100.0% | 13.9s | 13.9s | 0.0% | 675 | 1.15 | 20.75 | 44.6% | 842855 | none | none |
| 50 | armor | normal | pass | 100.0% | 2.1s | 2.1s | 0.0% | 1486 | 8.57 | 29.52 | 100.0% | 219463 | none | none |
| 50 | armor | boss | pass | 100.0% | 2.1s | 2.1s | 0.0% | 4457 | 5.71 | 32.38 | 100.0% | 5188389 | none | none |
| 50 | armor | highDefenseBoss | pass | 100.0% | 2.2s | 2.2s | 0.0% | 4179 | 9.82 | 33.93 | 100.0% | 3820811 | none | none |
| 50 | armor | highDodgeBoss | pass | 100.0% | 2.5s | 2.5s | 0.0% | 3714 | 7.94 | 38.10 | 98.6% | 5981752 | none | none |
| 50 | speedSkill | normal | pass | 100.0% | 1.2s | 1.2s | 0.0% | 2600 | 15.00 | 50.00 | 100.0% | 384060 | none | none |
| 50 | speedSkill | boss | pass | 100.0% | 1.2s | 1.2s | 0.0% | 7800 | 13.33 | 58.33 | 100.0% | 9452680 | none | none |
| 50 | speedSkill | highDefenseBoss | pass | 100.0% | 1.3s | 1.3s | 0.0% | 7312 | 18.75 | 96.87 | 100.0% | 9848137 | none | none |
| 50 | speedSkill | highDodgeBoss | pass | 100.0% | 1.3s | 1.3s | 0.0% | 7091 | 13.64 | 71.21 | 100.0% | 9101073 | none | none |
| 50 | luck | normal | warn | 100.0% | 2.4s | 2.4s | 0.0% | 3452 | 14.79 | 34.52 | 86.0% | 385249 | luck_income_out_of_band | combatPowerTradeoff |
| 50 | luck | boss | pass | 100.0% | 6.1s | 6.1s | 0.0% | 4158 | 5.94 | 29.70 | 55.3% | 2008634 | none | none |
| 50 | luck | highDefenseBoss | pass | 100.0% | 9.5s | 9.5s | 0.0% | 2654 | 3.79 | 21.90 | 45.1% | 1971673 | none | none |
| 50 | luck | highDodgeBoss | pass | 100.0% | 6.8s | 6.8s | 0.0% | 3720 | 5.31 | 26.57 | 53.3% | 1948039 | none | none |
| 100 | balanced | normal | pass | 100.0% | 1.9s | 1.9s | 0.0% | 3537 | 7.37 | 33.68 | 100.0% | 190017 | none | none |
| 100 | balanced | boss | pass | 100.0% | 5.5s | 5.5s | 0.0% | 3677 | 1.09 | 32.10 | 82.3% | 1848711 | none | none |
| 100 | balanced | highDefenseBoss | pass | 100.0% | 7.7s | 7.7s | 0.0% | 2605 | 3.36 | 32.04 | 81.9% | 1846291 | none | none |
| 100 | balanced | highDodgeBoss | pass | 100.0% | 5.4s | 5.4s | 0.0% | 3743 | 4.08 | 31.93 | 81.8% | 2401392 | none | none |
| 100 | crit | normal | pass | 100.0% | 1.9s | 1.9s | 0.0% | 3537 | 9.47 | 32.63 | 100.0% | 262648 | none | none |
| 100 | crit | boss | pass | 100.0% | 2.0s | 2.0s | 0.0% | 9964 | 10.87 | 32.62 | 99.6% | 4610360 | none | none |
| 100 | crit | highDefenseBoss | pass | 100.0% | 2.4s | 2.4s | 0.0% | 8423 | 9.19 | 31.75 | 98.5% | 4129260 | none | none |
| 100 | crit | highDodgeBoss | pass | 100.0% | 2.8s | 2.8s | 0.0% | 7296 | 7.96 | 34.02 | 98.9% | 4292894 | none | none |
| 100 | tank | normal | pass | 100.0% | 2.0s | 2.0s | 0.0% | 3321 | 11.86 | 31.63 | 96.5% | 304464 | none | none |
| 100 | tank | boss | pass | 100.0% | 11.8s | 11.8s | 0.0% | 1707 | 1.19 | 21.34 | 40.9% | 993285 | none | none |
| 100 | tank | highDefenseBoss | pass | 100.0% | 17.9s | 17.9s | 0.0% | 1127 | 1.01 | 17.33 | 30.6% | 814903 | none | none |
| 100 | tank | highDodgeBoss | pass | 100.0% | 12.9s | 12.9s | 0.0% | 1561 | 1.39 | 20.59 | 40.5% | 862010 | none | none |
| 100 | armor | normal | pass | 100.0% | 1.9s | 1.9s | 0.0% | 3537 | 11.58 | 31.58 | 100.0% | 304964 | none | none |
| 100 | armor | boss | pass | 100.0% | 1.9s | 1.9s | 0.0% | 10611 | 8.42 | 38.95 | 100.0% | 5586998 | none | none |
| 100 | armor | highDefenseBoss | pass | 100.0% | 1.9s | 1.9s | 0.0% | 10611 | 7.37 | 34.74 | 100.0% | 6026261 | none | none |
| 100 | armor | highDodgeBoss | pass | 100.0% | 2.3s | 2.3s | 0.0% | 8855 | 7.03 | 42.17 | 99.0% | 5880218 | none | none |
| 100 | speedSkill | normal | pass | 100.0% | 1.1s | 1.1s | 0.0% | 6109 | 9.09 | 54.55 | 100.0% | 235484 | none | none |
| 100 | speedSkill | boss | pass | 100.0% | 1.1s | 1.1s | 0.0% | 18327 | 14.55 | 63.64 | 100.0% | 10252451 | none | none |
| 100 | speedSkill | highDefenseBoss | pass | 100.0% | 1.3s | 1.3s | 0.0% | 15668 | 17.10 | 102.59 | 99.2% | 8262821 | none | none |
| 100 | speedSkill | highDodgeBoss | pass | 100.0% | 1.1s | 1.1s | 0.0% | 17736 | 14.08 | 84.46 | 100.0% | 7533691 | none | none |
| 100 | luck | normal | warn | 100.0% | 1.9s | 1.9s | 0.0% | 9806 | 19.35 | 34.41 | 98.2% | 499432 | luck_income_out_of_band | combatPowerTradeoff |
| 100 | luck | boss | pass | 100.0% | 6.2s | 6.2s | 0.0% | 8874 | 7.46 | 29.19 | 48.0% | 1828967 | none | none |
| 100 | luck | highDefenseBoss | pass | 100.0% | 9.5s | 9.5s | 0.0% | 5784 | 3.59 | 21.35 | 40.9% | 1218502 | none | none |
| 100 | luck | highDodgeBoss | pass | 100.0% | 6.4s | 6.4s | 0.0% | 8532 | 5.61 | 26.51 | 46.0% | 1346138 | none | none |
| 200 | balanced | normal | pass | 100.0% | 1.8s | 1.8s | 0.0% | 17904 | 10.27 | 43.35 | 99.2% | 297168 | none | none |
| 200 | balanced | boss | pass | 100.0% | 5.4s | 5.4s | 0.0% | 17505 | 4.46 | 36.80 | 82.4% | 1969759 | none | none |
| 200 | balanced | highDefenseBoss | pass | 100.0% | 7.6s | 7.6s | 0.0% | 12359 | 2.62 | 36.75 | 81.1% | 1027730 | none | none |
| 200 | balanced | highDodgeBoss | pass | 100.0% | 6.0s | 6.0s | 0.0% | 15784 | 5.70 | 36.87 | 80.4% | 1216677 | none | none |
| 200 | crit | normal | pass | 100.0% | 1.7s | 1.7s | 0.0% | 18466 | 16.47 | 41.18 | 100.0% | 431080 | none | none |
| 200 | crit | boss | pass | 100.0% | 2.2s | 2.2s | 0.0% | 42168 | 8.96 | 35.82 | 96.7% | 5566614 | none | none |
| 200 | crit | highDefenseBoss | pass | 100.0% | 4.4s | 4.4s | 0.0% | 21567 | 5.50 | 49.47 | 94.1% | 2448299 | none | none |
| 200 | crit | highDodgeBoss | pass | 100.0% | 3.5s | 3.5s | 0.0% | 27218 | 8.67 | 36.42 | 92.1% | 3945637 | none | none |
| 200 | tank | normal | pass | 100.0% | 4.3s | 4.3s | 0.0% | 7369 | 5.16 | 42.25 | 54.4% | 137802 | none | none |
| 200 | tank | boss | pass | 100.0% | 11.0s | 11.0s | 0.0% | 8528 | 1.99 | 22.28 | 41.5% | 1219696 | none | none |
| 200 | tank | highDefenseBoss | pass | 100.0% | 19.0s | 19.0s | 0.0% | 4950 | 1.58 | 19.24 | 34.7% | 483653 | none | none |
| 200 | tank | highDodgeBoss | pass | 100.0% | 13.5s | 13.5s | 0.0% | 6952 | 0.89 | 21.41 | 38.7% | 812311 | none | none |
| 200 | armor | normal | pass | 100.0% | 1.7s | 1.7s | 0.0% | 18466 | 16.47 | 35.29 | 100.0% | 431080 | none | none |
| 200 | armor | boss | pass | 100.0% | 1.8s | 1.8s | 0.0% | 52127 | 13.28 | 42.07 | 99.1% | 5216073 | none | none |
| 200 | armor | highDefenseBoss | pass | 100.0% | 1.9s | 1.9s | 0.0% | 49221 | 11.50 | 64.81 | 99.5% | 2870334 | none | none |
| 200 | armor | highDodgeBoss | pass | 100.0% | 2.1s | 2.1s | 0.0% | 45423 | 10.61 | 42.44 | 96.8% | 5676996 | none | none |
| 200 | speedSkill | normal | pass | 100.0% | 1.0s | 1.0s | 0.0% | 31392 | 24.00 | 60.00 | 100.0% | 630835 | none | none |
| 200 | speedSkill | boss | pass | 100.0% | 1.0s | 1.0s | 0.0% | 94176 | 24.00 | 120.00 | 100.0% | 12037306 | none | none |
| 200 | speedSkill | highDefenseBoss | pass | 100.0% | 2.1s | 2.1s | 0.0% | 45569 | 10.65 | 89.03 | 99.1% | 6200470 | none | none |
| 200 | speedSkill | highDodgeBoss | pass | 100.0% | 1.2s | 1.2s | 0.0% | 76359 | 19.46 | 108.65 | 100.0% | 10086896 | none | none |
| 200 | luck | normal | warn | 100.0% | 1.8s | 1.8s | 0.0% | 47003 | 21.78 | 41.38 | 86.3% | 607076 | luck_income_out_of_band | combatPowerTradeoff |
| 200 | luck | boss | pass | 100.0% | 6.2s | 6.2s | 0.0% | 41548 | 6.74 | 28.88 | 44.1% | 2533474 | none | none |
| 200 | luck | highDefenseBoss | pass | 100.0% | 10.9s | 10.9s | 0.0% | 23760 | 4.04 | 22.02 | 40.5% | 1358366 | none | none |
| 200 | luck | highDodgeBoss | pass | 100.0% | 7.0s | 7.0s | 0.0% | 37104 | 5.44 | 26.07 | 40.7% | 1802234 | none | none |
| 500 | balanced | normal | pass | 100.0% | 4.1s | 4.1s | 0.0% | 702333 | 8.35 | 33.39 | 91.2% | 637783 | none | none |
| 500 | balanced | boss | pass | 100.0% | 15.2s | 15.2s | 0.0% | 566378 | 1.85 | 33.00 | 90.5% | 994178 | none | none |
| 500 | balanced | highDefenseBoss | pass | 100.0% | 17.7s | 17.7s | 0.0% | 486169 | 1.59 | 32.63 | 90.0% | 973295 | none | none |
| 500 | balanced | highDodgeBoss | pass | 100.0% | 15.7s | 15.7s | 0.0% | 545152 | 1.40 | 32.78 | 90.2% | 1049645 | none | none |
| 500 | crit | normal | pass | 100.0% | 1.9s | 1.9s | 0.0% | 1469608 | 13.36 | 41.10 | 98.2% | 1222347 | none | none |
| 500 | crit | boss | pass | 100.0% | 11.8s | 11.8s | 0.0% | 726305 | 2.54 | 30.80 | 90.2% | 1448607 | none | none |
| 500 | crit | highDefenseBoss | pass | 100.0% | 13.4s | 13.4s | 0.0% | 641603 | 1.64 | 29.60 | 88.9% | 1001752 | none | none |
| 500 | crit | highDodgeBoss | pass | 100.0% | 13.5s | 13.5s | 0.0% | 636685 | 1.78 | 30.12 | 88.8% | 1312990 | none | none |
| 500 | tank | normal | pass | 100.0% | 11.1s | 11.1s | 0.0% | 257501 | 1.98 | 22.68 | 59.5% | 204996 | none | none |
| 500 | tank | boss | pass | 100.0% | 43.7s | 43.7s | 0.0% | 196426 | 0.73 | 18.17 | 50.0% | 341029 | none | none |
| 500 | tank | highDefenseBoss | pass | 100.0% | 54.6s | 54.6s | 0.0% | 157112 | 0.33 | 17.94 | 49.1% | 325154 | none | none |
| 500 | tank | highDodgeBoss | pass | 100.0% | 49.5s | 49.5s | 0.0% | 173501 | 0.61 | 18.32 | 50.7% | 311549 | none | none |
| 500 | armor | normal | pass | 100.0% | 1.5s | 1.5s | 0.0% | 1886265 | 18.46 | 46.15 | 100.0% | 1626265 | none | none |
| 500 | armor | boss | pass | 100.0% | 9.0s | 9.0s | 0.0% | 949043 | 3.54 | 33.39 | 93.4% | 1537830 | none | none |
| 500 | armor | highDefenseBoss | pass | 100.0% | 9.3s | 9.3s | 0.0% | 918243 | 3.00 | 33.38 | 93.1% | 2189562 | none | none |
| 500 | armor | highDodgeBoss | pass | 100.0% | 9.9s | 9.9s | 0.0% | 866628 | 2.22 | 32.31 | 90.7% | 1817661 | none | none |
| 500 | speedSkill | normal | pass | 100.0% | 0.8s | 0.8s | 0.0% | 3576045 | 25.00 | 75.00 | 100.0% | 2783127 | none | none |
| 500 | speedSkill | boss | pass | 100.0% | 1.8s | 1.8s | 0.0% | 4839760 | 12.41 | 109.40 | 96.7% | 12339307 | none | none |
| 500 | speedSkill | highDefenseBoss | pass | 100.0% | 3.0s | 3.0s | 0.0% | 2886494 | 6.73 | 81.39 | 79.1% | 5637412 | none | none |
| 500 | speedSkill | highDodgeBoss | pass | 100.0% | 2.0s | 2.0s | 0.0% | 4349244 | 16.22 | 102.36 | 93.3% | 10484546 | none | none |
| 500 | luck | normal | warn | 100.0% | 2.4s | 2.4s | 0.0% | 3331552 | 21.49 | 49.59 | 57.8% | 2564716 | luck_income_out_of_band | combatPowerTradeoff |
| 500 | luck | boss | pass | 100.0% | 9.0s | 9.0s | 0.0% | 2681493 | 6.43 | 25.06 | 38.3% | 3800359 | none | none |
| 500 | luck | highDefenseBoss | pass | 100.0% | 11.8s | 11.8s | 0.0% | 2046283 | 4.23 | 22.00 | 38.5% | 2408328 | none | none |
| 500 | luck | highDodgeBoss | pass | 100.0% | 10.1s | 10.1s | 0.0% | 2404281 | 5.77 | 24.25 | 39.0% | 2805571 | none | none |
| 1000 | balanced | normal | pass | 100.0% | 9.7s | 9.7s | 0.0% | 463449501 | 3.08 | 36.18 | 88.1% | 278159423 | none | none |
| 1000 | balanced | boss | pass | 100.0% | 40.6s | 40.6s | 0.0% | 332848953 | 1.23 | 31.05 | 83.6% | 200093450 | none | none |
| 1000 | balanced | highDefenseBoss | pass | 100.0% | 49.9s | 49.9s | 0.0% | 271049708 | 0.52 | 31.14 | 83.6% | 162947208 | none | none |
| 1000 | balanced | highDodgeBoss | pass | 100.0% | 41.3s | 41.3s | 0.0% | 327741846 | 0.97 | 31.06 | 84.4% | 196946993 | none | none |
| 1000 | crit | normal | pass | 100.0% | 8.0s | 8.0s | 0.0% | 563905417 | 3.75 | 35.76 | 88.2% | 338441616 | none | none |
| 1000 | crit | boss | pass | 100.0% | 29.9s | 29.9s | 0.0% | 452242844 | 0.87 | 32.63 | 86.1% | 271675961 | none | none |
| 1000 | crit | highDefenseBoss | pass | 100.0% | 37.4s | 37.4s | 0.0% | 361907195 | 1.02 | 31.57 | 85.3% | 217443948 | none | none |
| 1000 | crit | highDodgeBoss | pass | 100.0% | 31.8s | 31.8s | 0.0% | 425724041 | 1.20 | 31.97 | 86.1% | 255901768 | none | none |
| 1000 | tank | normal | pass | 100.0% | 30.2s | 30.2s | 0.0% | 149300198 | 1.13 | 21.12 | 47.1% | 89608824 | none | none |
| 1000 | tank | boss | pass | 100.0% | 116.6s | 116.6s | 0.0% | 116047904 | 0.22 | 19.15 | 44.4% | 69739798 | none | none |
| 1000 | tank | highDefenseBoss | pass | 100.0% | 145.0s | 145.0s | 0.0% | 93269305 | 0.18 | 19.29 | 44.5% | 56063052 | none | none |
| 1000 | tank | highDodgeBoss | pass | 100.0% | 121.4s | 121.4s | 0.0% | 111458510 | 0.21 | 19.20 | 44.3% | 66956737 | none | none |
| 1000 | armor | normal | pass | 100.0% | 5.4s | 5.4s | 0.0% | 837652690 | 7.80 | 35.29 | 90.7% | 502790561 | none | none |
| 1000 | armor | boss | pass | 100.0% | 23.7s | 23.7s | 0.0% | 570083900 | 1.60 | 33.46 | 89.1% | 342612439 | none | none |
| 1000 | armor | highDefenseBoss | pass | 100.0% | 30.1s | 30.1s | 0.0% | 448841770 | 0.93 | 33.38 | 88.6% | 269715745 | none | none |
| 1000 | armor | highDodgeBoss | pass | 100.0% | 24.8s | 24.8s | 0.0% | 544901622 | 1.29 | 33.43 | 88.9% | 327320984 | none | none |
| 1000 | speedSkill | normal | pass | 100.0% | 1.4s | 1.4s | 0.0% | 3146067661 | 26.51 | 128.37 | 99.1% | 1888361853 | none | none |
| 1000 | speedSkill | boss | pass | 100.0% | 5.8s | 5.8s | 0.0% | 2332429473 | 5.17 | 84.83 | 71.8% | 1400830960 | none | none |
| 1000 | speedSkill | highDefenseBoss | pass | 100.0% | 7.6s | 7.6s | 0.0% | 1786279614 | 5.28 | 80.02 | 72.4% | 1073706888 | none | none |
| 1000 | speedSkill | highDodgeBoss | pass | 100.0% | 5.6s | 5.6s | 0.0% | 2407133620 | 6.41 | 86.48 | 72.0% | 1446421595 | none | none |
| 1000 | luck | normal | warn | 100.0% | 6.4s | 6.4s | 0.0% | 2035230846 | 9.42 | 28.26 | 32.3% | 1221387738 | luck_income_out_of_band | combatPowerTradeoff |
| 1000 | luck | boss | pass | 100.0% | 31.7s | 31.7s | 0.0% | 1227562171 | 1.64 | 22.98 | 37.5% | 736931390 | none | none |
| 1000 | luck | highDefenseBoss | pass | 100.0% | 41.7s | 41.7s | 0.0% | 931798310 | 1.39 | 23.00 | 39.5% | 559307271 | none | none |
| 1000 | luck | highDodgeBoss | pass | 100.0% | 34.0s | 34.0s | 0.0% | 1145266828 | 1.65 | 22.79 | 37.3% | 687595220 | none | none |

## Raw Combat Metrics

| 难度 | 构筑 | 场景 | 怪物HP | 怪物攻击 | 怪物防御 | 玩家DPS | 钻石/分钟 | 资源成长/分钟 |
|---:|---|---|---:|---:|---:|---:|---:|---:|
| 10 | balanced | normal | 92 | 9 | 5 | 69.6 | 0.00 | 10213.5 |
| 10 | balanced | boss | 368 | 12 | 6 | 64.8 | 352.68 | 44078.2 |
| 10 | balanced | highDefenseBoss | 460 | 12 | 27 | 68.9 | 333.16 | 41966.6 |
| 10 | balanced | highDodgeBoss | 331 | 12 | 6 | 57.1 | 515.57 | 63848.8 |
| 10 | crit | normal | 92 | 9 | 5 | 656.4 | 0.00 | 6133.5 |
| 10 | crit | boss | 368 | 12 | 6 | 337.9 | 544.80 | 69888.2 |
| 10 | crit | highDefenseBoss | 460 | 12 | 27 | 388.9 | 727.30 | 90850.7 |
| 10 | crit | highDodgeBoss | 331 | 12 | 6 | 266.3 | 564.00 | 71318.9 |
| 10 | tank | normal | 92 | 9 | 5 | 46.1 | 2.40 | 6421.5 |
| 10 | tank | boss | 368 | 12 | 6 | 26.2 | 149.87 | 18656.2 |
| 10 | tank | highDefenseBoss | 460 | 12 | 27 | 25.5 | 166.13 | 20823.9 |
| 10 | tank | highDodgeBoss | 331 | 12 | 6 | 21.1 | 142.54 | 18254.6 |
| 10 | armor | normal | 92 | 9 | 5 | 185.2 | 3.20 | 5837.5 |
| 10 | armor | boss | 368 | 12 | 6 | 177.3 | 733.33 | 92000.3 |
| 10 | armor | highDefenseBoss | 460 | 12 | 27 | 189.7 | 829.41 | 109165.1 |
| 10 | armor | highDodgeBoss | 331 | 12 | 6 | 127.7 | 833.00 | 103810.3 |
| 10 | speedSkill | normal | 92 | 9 | 5 | 323.5 | 0.00 | 10952.6 |
| 10 | speedSkill | boss | 368 | 12 | 6 | 400.6 | 2152.65 | 273992.5 |
| 10 | speedSkill | highDefenseBoss | 460 | 12 | 27 | 559.5 | 1588.39 | 206612.3 |
| 10 | speedSkill | highDodgeBoss | 331 | 12 | 6 | 380.4 | 1256.72 | 160513.2 |
| 10 | luck | normal | 92 | 9 | 5 | 49.7 | 0.00 | 9560.4 |
| 10 | luck | boss | 368 | 12 | 6 | 52.8 | 291.90 | 38778.8 |
| 10 | luck | highDefenseBoss | 460 | 12 | 27 | 48.7 | 401.61 | 51171.8 |
| 10 | luck | highDodgeBoss | 331 | 12 | 6 | 39.2 | 260.27 | 34030.0 |
| 50 | balanced | normal | 160 | 16 | 7 | 123.8 | 0.00 | 9429.7 |
| 50 | balanced | boss | 643 | 22 | 33 | 146.1 | 565.71 | 71483.3 |
| 50 | balanced | highDefenseBoss | 803 | 22 | 145 | 137.2 | 649.77 | 80351.3 |
| 50 | balanced | highDodgeBoss | 578 | 22 | 33 | 118.8 | 598.62 | 75670.8 |
| 50 | crit | normal | 160 | 16 | 7 | 844.1 | 0.00 | 10330.0 |
| 50 | crit | boss | 643 | 22 | 33 | 724.6 | 979.92 | 124883.1 |
| 50 | crit | highDefenseBoss | 803 | 22 | 145 | 606.2 | 747.04 | 96817.8 |
| 50 | crit | highDodgeBoss | 578 | 22 | 33 | 541.1 | 1217.02 | 152300.1 |
| 50 | tank | normal | 160 | 16 | 7 | 67.0 | 0.00 | 7722.1 |
| 50 | tank | boss | 643 | 22 | 33 | 57.2 | 238.17 | 30293.5 |
| 50 | tank | highDefenseBoss | 803 | 22 | 145 | 48.6 | 158.15 | 19958.2 |
| 50 | tank | highDodgeBoss | 578 | 22 | 33 | 47.2 | 225.85 | 28095.2 |
| 50 | armor | normal | 160 | 16 | 7 | 381.7 | 0.00 | 7315.4 |
| 50 | armor | boss | 643 | 22 | 33 | 427.4 | 1400.00 | 172946.3 |
| 50 | armor | highDefenseBoss | 803 | 22 | 145 | 400.7 | 991.07 | 127360.4 |
| 50 | armor | highDodgeBoss | 578 | 22 | 33 | 350.3 | 1604.76 | 199391.7 |
| 50 | speedSkill | normal | 160 | 16 | 7 | 639.9 | 0.00 | 12802.0 |
| 50 | speedSkill | boss | 643 | 22 | 33 | 693.4 | 2530.00 | 315089.3 |
| 50 | speedSkill | highDefenseBoss | 803 | 22 | 145 | 945.9 | 2601.56 | 328271.2 |
| 50 | speedSkill | highDodgeBoss | 578 | 22 | 33 | 699.8 | 2430.30 | 303369.1 |
| 50 | luck | normal | 160 | 16 | 7 | 87.3 | 1.64 | 12841.6 |
| 50 | luck | boss | 643 | 22 | 33 | 122.0 | 515.18 | 66954.5 |
| 50 | luck | highDefenseBoss | 803 | 22 | 145 | 90.1 | 520.39 | 65722.4 |
| 50 | luck | highDodgeBoss | 578 | 22 | 33 | 94.2 | 502.85 | 64934.6 |
| 100 | balanced | normal | 323 | 32 | 10 | 319.6 | 0.00 | 6333.9 |
| 100 | balanced | boss | 1294 | 45 | 48 | 283.4 | 505.17 | 61623.7 |
| 100 | balanced | highDefenseBoss | 1617 | 45 | 233 | 233.5 | 488.63 | 61543.0 |
| 100 | balanced | highDodgeBoss | 1164 | 45 | 48 | 251.0 | 637.50 | 80046.4 |
| 100 | crit | normal | 323 | 32 | 10 | 1369.1 | 5.26 | 8754.9 |
| 100 | crit | boss | 1294 | 45 | 48 | 1260.7 | 1201.98 | 153678.7 |
| 100 | crit | highDefenseBoss | 1617 | 45 | 233 | 920.4 | 1080.50 | 137642.0 |
| 100 | crit | highDodgeBoss | 1164 | 45 | 48 | 839.1 | 1134.86 | 143096.5 |
| 100 | tank | normal | 323 | 32 | 10 | 175.5 | 0.00 | 10148.8 |
| 100 | tank | boss | 1294 | 45 | 48 | 120.7 | 267.23 | 33109.5 |
| 100 | tank | highDefenseBoss | 1617 | 45 | 233 | 92.2 | 219.05 | 27163.4 |
| 100 | tank | highDodgeBoss | 1164 | 45 | 48 | 98.1 | 229.32 | 28733.7 |
| 100 | armor | normal | 323 | 32 | 10 | 832.9 | 2.11 | 10165.5 |
| 100 | armor | boss | 1294 | 45 | 48 | 869.2 | 1490.53 | 186233.3 |
| 100 | armor | highDefenseBoss | 1617 | 45 | 233 | 875.4 | 1620.00 | 200875.4 |
| 100 | armor | highDodgeBoss | 1164 | 45 | 48 | 722.8 | 1582.14 | 196007.3 |
| 100 | speedSkill | normal | 323 | 32 | 10 | 1218.5 | 0.00 | 7849.5 |
| 100 | speedSkill | boss | 1294 | 45 | 48 | 1320.2 | 2741.82 | 341748.4 |
| 100 | speedSkill | highDefenseBoss | 1617 | 45 | 233 | 1468.9 | 2171.50 | 275427.4 |
| 100 | speedSkill | highDodgeBoss | 1164 | 45 | 48 | 1540.5 | 1990.03 | 251123.0 |
| 100 | luck | normal | 323 | 32 | 10 | 227.8 | 0.00 | 16647.7 |
| 100 | luck | boss | 1294 | 45 | 48 | 246.7 | 453.73 | 60965.6 |
| 100 | luck | highDefenseBoss | 1617 | 45 | 233 | 182.3 | 312.05 | 40616.7 |
| 100 | luck | highDodgeBoss | 1164 | 45 | 48 | 198.9 | 332.74 | 44871.3 |
| 200 | balanced | normal | 1309 | 130 | 15 | 1189.4 | 6.84 | 9905.6 |
| 200 | balanced | boss | 5237 | 183 | 72 | 1099.3 | 512.64 | 65658.6 |
| 200 | balanced | highDefenseBoss | 6546 | 183 | 390 | 918.5 | 264.83 | 34257.7 |
| 200 | balanced | highDodgeBoss | 4713 | 183 | 72 | 902.1 | 294.97 | 40555.9 |
| 200 | crit | normal | 1309 | 130 | 15 | 3182.3 | 0.00 | 14369.3 |
| 200 | crit | boss | 5237 | 183 | 72 | 2620.5 | 1475.82 | 185553.8 |
| 200 | crit | highDefenseBoss | 6546 | 183 | 390 | 1666.0 | 637.56 | 81610.0 |
| 200 | crit | highDodgeBoss | 4713 | 183 | 72 | 1687.6 | 1030.06 | 131521.2 |
| 200 | tank | normal | 1309 | 130 | 15 | 377.2 | 0.47 | 4593.4 |
| 200 | tank | boss | 5237 | 183 | 72 | 489.5 | 323.27 | 40656.5 |
| 200 | tank | highDefenseBoss | 6546 | 183 | 390 | 352.3 | 122.35 | 16121.8 |
| 200 | tank | highDodgeBoss | 4713 | 183 | 72 | 377.7 | 218.21 | 27077.0 |
| 200 | armor | normal | 1309 | 130 | 15 | 2933.5 | 0.00 | 14369.3 |
| 200 | armor | boss | 5237 | 183 | 72 | 3114.0 | 1346.13 | 173869.1 |
| 200 | armor | highDefenseBoss | 6546 | 183 | 390 | 4201.9 | 707.67 | 95677.8 |
| 200 | armor | highDodgeBoss | 4713 | 183 | 72 | 2669.8 | 1494.21 | 189233.2 |
| 200 | speedSkill | normal | 1309 | 130 | 15 | 4617.0 | 0.00 | 21027.8 |
| 200 | speedSkill | boss | 5237 | 183 | 72 | 7397.9 | 3158.00 | 401243.5 |
| 200 | speedSkill | highDefenseBoss | 6546 | 183 | 390 | 3532.3 | 1639.35 | 206682.3 |
| 200 | speedSkill | highDodgeBoss | 4713 | 183 | 72 | 5445.9 | 2651.35 | 336229.9 |
| 200 | luck | normal | 1309 | 130 | 15 | 804.2 | 6.53 | 20235.9 |
| 200 | luck | boss | 5237 | 183 | 72 | 952.2 | 649.09 | 84449.1 |
| 200 | luck | highDefenseBoss | 6546 | 183 | 390 | 620.4 | 344.77 | 45278.9 |
| 200 | luck | highDodgeBoss | 4713 | 183 | 72 | 757.8 | 455.87 | 60074.5 |
| 500 | balanced | normal | 86692 | 8669 | 30 | 25432.9 | 0.98 | 21259.4 |
| 500 | balanced | boss | 346770 | 12136 | 144 | 24402.6 | 168.68 | 33139.3 |
| 500 | balanced | highDefenseBoss | 433462 | 12136 | 860 | 25380.6 | 178.10 | 32443.2 |
| 500 | balanced | highDodgeBoss | 312093 | 12136 | 144 | 20991.7 | 190.81 | 34988.2 |
| 500 | crit | normal | 86692 | 8669 | 30 | 62896.5 | 0.00 | 40744.9 |
| 500 | crit | boss | 346770 | 12136 | 144 | 35674.3 | 263.36 | 48286.9 |
| 500 | crit | highDefenseBoss | 433462 | 12136 | 860 | 33925.5 | 159.68 | 33391.7 |
| 500 | crit | highDodgeBoss | 312093 | 12136 | 144 | 26970.5 | 245.99 | 43766.3 |
| 500 | tank | normal | 86692 | 8669 | 30 | 8478.4 | 0.00 | 6833.2 |
| 500 | tank | boss | 346770 | 12136 | 144 | 8047.1 | 56.81 | 11367.6 |
| 500 | tank | highDefenseBoss | 433462 | 12136 | 860 | 8134.9 | 61.80 | 10838.5 |
| 500 | tank | highDodgeBoss | 312093 | 12136 | 144 | 6519.4 | 53.33 | 10385.0 |
| 500 | armor | normal | 86692 | 8669 | 30 | 91204.8 | 6.59 | 54208.8 |
| 500 | armor | boss | 346770 | 12136 | 144 | 50875.8 | 243.94 | 51261.0 |
| 500 | armor | highDefenseBoss | 433462 | 12136 | 860 | 50299.0 | 433.95 | 72985.4 |
| 500 | armor | highDodgeBoss | 312093 | 12136 | 144 | 35809.5 | 344.73 | 60588.7 |
| 500 | speedSkill | normal | 86692 | 8669 | 30 | 188145.8 | 0.00 | 92770.9 |
| 500 | speedSkill | boss | 346770 | 12136 | 144 | 205484.3 | 2533.08 | 411310.2 |
| 500 | speedSkill | highDefenseBoss | 433462 | 12136 | 860 | 149341.4 | 1037.22 | 187913.7 |
| 500 | speedSkill | highDodgeBoss | 312093 | 12136 | 144 | 169923.7 | 2072.64 | 349484.9 |
| 500 | luck | normal | 86692 | 8669 | 30 | 38265.4 | 4.96 | 85490.5 |
| 500 | luck | boss | 346770 | 12136 | 144 | 40932.9 | 563.19 | 126678.6 |
| 500 | luck | highDefenseBoss | 433462 | 12136 | 860 | 38432.6 | 297.97 | 80277.6 |
| 500 | luck | highDodgeBoss | 312093 | 12136 | 144 | 32807.8 | 337.77 | 93519.0 |
| 1000 | balanced | normal | 93945076 | 9394507 | 55 | 10436825.9 | 3.08 | 9271980.8 |
| 1000 | balanced | boss | 375780304 | 13152310 | 264 | 9465891.5 | 97.97 | 6669781.7 |
| 1000 | balanced | highDefenseBoss | 469725380 | 13152310 | 1644 | 9540716.4 | 84.47 | 5431573.6 |
| 1000 | balanced | highDodgeBoss | 338202273 | 13152310 | 264 | 8350122.7 | 76.99 | 6564899.8 |
| 1000 | crit | normal | 93945076 | 9394507 | 55 | 13315471.0 | 0.75 | 11281387.2 |
| 1000 | crit | boss | 375780304 | 13152310 | 264 | 12809512.1 | 85.58 | 9055865.4 |
| 1000 | crit | highDefenseBoss | 469725380 | 13152310 | 1644 | 12819053.8 | 76.03 | 7248131.6 |
| 1000 | crit | highDodgeBoss | 338202273 | 13152310 | 264 | 11073513.1 | 121.35 | 8530058.9 |
| 1000 | tank | normal | 93945076 | 9394507 | 55 | 3235802.7 | 0.00 | 2986960.8 |
| 1000 | tank | boss | 375780304 | 13152310 | 264 | 3241514.4 | 29.27 | 2324659.9 |
| 1000 | tank | highDefenseBoss | 469725380 | 13152310 | 1644 | 3257071.0 | 26.92 | 1868768.4 |
| 1000 | tank | highDodgeBoss | 338202273 | 13152310 | 264 | 2813564.6 | 21.16 | 2231891.2 |
| 1000 | armor | normal | 93945076 | 9394507 | 55 | 18061323.4 | 0.00 | 16759685.4 |
| 1000 | armor | boss | 375780304 | 13152310 | 264 | 16800768.8 | 144.80 | 11420414.6 |
| 1000 | armor | highDefenseBoss | 469725380 | 13152310 | 1644 | 16218472.7 | 107.50 | 8990524.8 |
| 1000 | armor | highDodgeBoss | 338202273 | 13152310 | 264 | 14359265.4 | 96.43 | 10910699.5 |
| 1000 | speedSkill | normal | 93945076 | 9394507 | 55 | 81536458.0 | 12.56 | 62945395.1 |
| 1000 | speedSkill | boss | 375780304 | 13152310 | 264 | 66642246.5 | 344.83 | 46694365.3 |
| 1000 | speedSkill | highDefenseBoss | 469725380 | 13152310 | 1644 | 64206087.8 | 501.23 | 35790229.6 |
| 1000 | speedSkill | highDodgeBoss | 338202273 | 13152310 | 264 | 62779117.4 | 549.47 | 48214053.2 |
| 1000 | luck | normal | 93945076 | 9394507 | 55 | 15022509.6 | 2.51 | 40712924.6 |
| 1000 | luck | boss | 375780304 | 13152310 | 264 | 11944305.3 | 97.84 | 24564379.7 |
| 1000 | luck | highDefenseBoss | 469725380 | 13152310 | 1644 | 11313867.8 | 53.57 | 18643575.7 |
| 1000 | luck | highDodgeBoss | 338202273 | 13152310 | 264 | 10042321.9 | 109.19 | 22919840.7 |
