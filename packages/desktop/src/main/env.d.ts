interface ImportMetaEnv {
  readonly OPENCODE_CHANNEL: string
  readonly OPENCODE_VERSION?: string
  // RAD-governed builds only: RAD's web origin, API root and usage API, its public Firebase web config (JSON) for
  // the corporate Google sign-in, and BambuIAFrameWork.
  readonly RAD_WEB_ORIGIN?: string
  readonly RAD_API_URL?: string
  readonly RAD_USAGE_API?: string
  readonly RAD_FIREBASE_CONFIG?: string
  readonly BAMBU_IA_ORIGIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
