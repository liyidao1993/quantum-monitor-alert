# Stocks_US

美股数据模块。当前阶段保持轻量化，只提供按需 HTTP 数据读取，不常驻后台轮询。

- 数据源：Yahoo Finance Chart
- UI：`src/views/StocksUsView.tsx`
- 后端接口：`GET /api/stocks-us/klines`
