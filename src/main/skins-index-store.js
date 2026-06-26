const createSkinsIndexStore = ({ fs, path, getAppDataDir }) => {
  const getIndexPath = () => path.join(getAppDataDir(), "cache", "skins_index.json");
  const getPreviewCacheDir = () => path.join(getAppDataDir(), "cache", "previews");

  const read = async () => {
    const indexPath = getIndexPath();
    try {
      const payload = JSON.parse(await fs.readFile(indexPath, "utf8"));
      return {
        version: 1,
        skins: Array.isArray(payload.skins) ? payload.skins : [],
        profiles: Array.isArray(payload.profiles) ? payload.profiles : [],
        metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
        indexPath,
        updatedAt: payload.updatedAt || ""
      };
    } catch {
      return { version: 1, skins: [], profiles: [], metadata: {}, indexPath, updatedAt: "" };
    }
  };

  const write = async (payload = {}) => {
    const indexPath = getIndexPath();
    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    const safePayload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      skins: Array.isArray(payload.skins) ? payload.skins : [],
      profiles: Array.isArray(payload.profiles) ? payload.profiles : [],
      metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}
    };
    await fs.writeFile(indexPath, JSON.stringify(safePayload, null, 2), "utf8");
    return { ok: true, indexPath, updatedAt: safePayload.updatedAt };
  };

  return { getIndexPath, getPreviewCacheDir, read, write };
};

module.exports = { createSkinsIndexStore };
