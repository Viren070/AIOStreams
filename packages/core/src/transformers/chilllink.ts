import { ParsedStream, Resource, UserData } from '../db/index.js';
import { createFormatter } from '../formatters/index.js';
import { AIOStreamsError, AIOStreamsResponse } from '../main.js';
import { z } from 'zod';
import { StreamType } from '../utils/constants.js';
import { Env } from '../utils/env.js';

type ErrorOptions = {
  errorTitle?: string;
  errorDescription?: string;
  errorUrl?: string;
};

export interface ChillLinkResponseData {
  sources: ChillLinkSource[];
}

const ChillLinkSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  metadata: z.array(z.string()),
});

export type ChillLinkSource = z.infer<typeof ChillLinkSourceSchema>;

export class ChillLinkTransformer {
  private readonly supportedTypes: StreamType[] = [
    'http',
    'usenet',
    'debrid',
    'live',
  ];
  constructor(private readonly userData: UserData) {}

  public showError(resource: Resource, errors: AIOStreamsError[]) {
    if (
      errors.length > 0 &&
      !this.userData.hideErrors &&
      !this.userData.hideErrorsForResources?.includes(resource)
    ) {
      return true;
    }
    return false;
  }

  async transformStreams(
    response: AIOStreamsResponse<{
      streams: ParsedStream[];
      statistics: { title: string; description: string }[];
    }>
  ): Promise<ChillLinkResponseData> {
    const { data, errors } = response;

    const formatter = createFormatter(this.userData);

    const results = await Promise.all(
      data.streams.map(async (stream, index) =>
        this.convertParsedStreamToStream(stream, formatter, index, {})
      )
    );

    const filteredResults = results.filter(
      (result): result is ChillLinkSource => result !== null
    );

    // add errors to the end (if this.userData.hideErrors is false  or the resource is not in this.userData.hideErrorsForResources)
    if (this.showError('stream', errors)) {
      filteredResults.push(
        ...errors.map((error) =>
          ChillLinkTransformer.createErrorStream({
            errorTitle: error.title,
            errorDescription: error.description,
          })
        )
      );
    }

    return {
      sources: filteredResults,
    };
  }

  private async convertParsedStreamToStream(
    stream: ParsedStream,
    formatter: {
      format: (
        stream: ParsedStream
      ) => Promise<{ name: string; description: string }>;
    },
    index: number,
    options?: { disableAutoplay?: boolean; provideStreamData?: boolean }
  ): Promise<ChillLinkSource | null> {
    const { name, description } = stream.addon.formatPassthrough
      ? {
          name: stream.originalName || stream.addon.name,
          description: stream.originalDescription,
        }
      : await formatter.format(stream);

    if (!this.supportedTypes.includes(stream.type)) {
      return null;
    }

    if (!stream.url) {
      return null;
    }

    // form metadata array using description (each line in desc is a separate metadata item)
    const metadata = description
      ? description
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
      : [];
    return {
      id: `${Env.ADDON_ID}.${stream.id}`,
      title: name,
      url: stream.url,
      metadata,
    };
  }

  static createErrorStream(options: ErrorOptions = {}): ChillLinkSource {
    const {
      errorTitle = `[❌] ${Env.ADDON_NAME}`,
      errorDescription = 'Unknown error',
      errorUrl = 'https://github.com/Viren070/AIOStreams',
    } = options;
    return {
      id: `${Env.ADDON_ID}.error.${Math.random().toString(36).slice(2, 10)}`,
      title: `${errorTitle} - ${errorDescription}`,
      url: errorUrl,
      metadata: [],
    };
  }
}
