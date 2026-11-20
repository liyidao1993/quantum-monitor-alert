# Binance Data Transformer

负责币安数据清洗和指标计算。

MA60 偏离值计算规则：

```text
(current_price - ma60_snapshot) / ma60_snapshot
```

模块不得长期保存 K 线历史数组。

