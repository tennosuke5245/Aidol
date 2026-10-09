# 工作成果回收協定

`handoff.json` 包含固定的 `jobId`、`projectId`、`outfitId`、`outputView`、loopback `submitUrl`、`token` 與來源工作快照。憑證只用來回傳該工作，不要顯示於聊天或附加在圖像 prompt。

回收使用 multipart/form-data，欄位 `images` 為圖片；`manifest` 為 JSON：

```json
{
  "schemaVersion": 1,
  "jobId": "指定工作ID",
  "source": "codex-app",
  "threadId": null,
  "outputs": [{ "name": "候選稿", "view": "detail", "sha256": "圖片SHA256" }]
}
```

header `Authorization: Bearer <handoff token>` 由 helper 設定。manifest 不是產圖能力的證明，必須只提交實際圖像工具返回的檔案。工作台會檢查工作 ID、憑證、圖片格式、雜湊與基礎版本，將過時結果保留為不可直接採用的候選。

相同工作及相同雜湊的重送回傳既有候選，不新增重複圖稿。不同工作的成果不可混用。收到拒絕時保留原檔及錯誤原因；確認交接檔與工作後再處理，不猜測 token 或修改其他專案。

## 進度回報

`handoff.json` 另有 `progressUrl` 與 `variants`（本次張數）。以相同 Bearer 憑證送出 JSON `{"event":"started"}`、`{"event":"finished"}` 或 `{"event":"failed","message":"原因"}`；helper 的 `--event` 參數會代為送出。AIDOL 只依這些真實回報顯示「繪製中」與完成，回傳張數則依實際收到的候選計算。不要在尚未開始時回報 started，也不要用 finished 代替提交圖片。
