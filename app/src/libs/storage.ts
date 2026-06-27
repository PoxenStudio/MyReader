import { isWebAppPlatform } from '@/services/environment';
import { AppService } from '@/types/system';
import { tauriDownload, webDownload, ProgressHandler } from '@/utils/transfer';

type DownloadFileParams = {
  appService: AppService;
  dst: string;
  url: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  singleThreaded?: boolean;
  skipSslVerification?: boolean;
  onProgress?: ProgressHandler;
};

export const downloadFile = async ({
  appService,
  dst,
  url,
  headers,
  credentials,
  singleThreaded,
  skipSslVerification,
  onProgress,
}: DownloadFileParams) => {
  try {
    if (isWebAppPlatform()) {
      const { headers: responseHeaders, blob } = await webDownload(
        url,
        onProgress,
        headers,
        credentials,
      );
      await appService.writeFile(dst, 'None', await blob.arrayBuffer());
      return responseHeaders;
    } else {
      return await tauriDownload(
        url,
        dst,
        onProgress,
        headers,
        undefined,
        singleThreaded,
        skipSslVerification,
      );
    }
  } catch (error) {
    console.error(`File '${dst}' download failed:`, error);
    throw error;
  }
};
