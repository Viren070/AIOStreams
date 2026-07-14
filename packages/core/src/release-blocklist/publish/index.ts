import { registerPublishProvider } from './provider.js';
import { githubGistProvider } from './providers/github-gist.js';

registerPublishProvider(githubGistProvider);

export * from './types.js';
export {
  registerPublishProvider,
  getPublishProvider,
  listPublishProviders,
  checkArtifactsAgainstCapabilities,
  type PublishFile,
  type PublishOutcome,
  type PublishProvider,
  type PublishProviderCapabilities,
  type PublishProviderField,
} from './provider.js';
export {
  encodePublishConfig,
  decodePublishConfig,
  applyConfigPatch,
} from './config.js';
export { ReleaseBlocklistPublishService } from './publisher.js';
export {
  githubGistProvider,
  type GithubGistConfig,
} from './providers/github-gist.js';
