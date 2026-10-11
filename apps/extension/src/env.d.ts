interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly WXT_API_BASE?: string;
  readonly WXT_LOCAL_STACK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
