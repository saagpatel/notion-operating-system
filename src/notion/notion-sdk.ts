import { Client } from "@notionhq/client";

import { DEFAULT_NOTION_VERSION } from "../config/runtime-config.js";

export function createNotionSdkClient(token: string): Client {
  return new Client({
    auth: token,
    notionVersion: DEFAULT_NOTION_VERSION,
  });
}
