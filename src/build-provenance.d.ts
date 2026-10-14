declare module '@visa/build-provenance' {
  const provenance: {
    schemaVersion: number;
    gitSha: string | null;
    gitTree: string | null;
    sourceSha256: string | null;
    dirty: boolean;
    appEnvironment: string;
    siteOrigin: string | null;
    configSha256: string;
  };
  export default provenance;
}
