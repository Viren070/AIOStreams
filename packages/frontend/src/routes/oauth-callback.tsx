import { useEffect } from 'react';
import { LoadingOverlay } from '@/components/ui/loading-spinner';
import { TextGenerateEffect } from '@/components/shared/text-generate-effect';
import { LuffyError } from '@/components/shared/luffy-error';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/button';
import { toast } from 'sonner';
import { exchangeGDriveCode } from '@/lib/api';
import { BiCopy } from 'react-icons/bi';
import { copyToClipboard } from '@/utils/clipboard';
import { useMutation } from '@tanstack/react-query';

export function OAuthCallback() {
  const { mutate, isPending, data, error } = useMutation({
    mutationFn: (code: string) => exchangeGDriveCode(code),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errorParam = params.get('error');
    const code = params.get('code');
    if (errorParam || !code) return; // error rendered below
    mutate(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCopy = async () => {
    if (data?.refreshToken) {
      await copyToClipboard(data.refreshToken, {
        onSuccess: () => toast.success('Copied!'),
        onError: () => toast.error('Failed to copy'),
      });
    }
  };

  const urlError = new URLSearchParams(window.location.search).get('error');
  const displayError = urlError
    ? urlError
    : error
      ? (error as Error).message
      : !new URLSearchParams(window.location.search).get('code')
        ? 'No authorization code found in URL'
        : null;

  if (isPending) {
    return (
      <LoadingOverlay showSpinner>
        <TextGenerateEffect
          words="Processing OAuth callback..."
          className="text-2xl"
        />
      </LoadingOverlay>
    );
  }

  if (displayError) {
    return (
      <LoadingOverlay showSpinner={false}>
        <LuffyError title="OAuth Error" showRefreshButton>
          <p>{displayError}</p>
        </LuffyError>
      </LoadingOverlay>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-lg p-6">
        <h1 className="text-2xl font-bold mb-4">Google Drive Authorisation</h1>
        <div className="space-y-4">
          <div className="text-[--muted] space-y-2">
            <p>Authorisation successful! Please follow these steps:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Copy the refresh token below</li>
              <li>Return to the previous tab</li>
              <li>Paste the refresh token into the Refresh Token field</li>
            </ol>
          </div>
          {data?.refreshToken && (
            <div className="relative">
              <div className="p-4 pr-12 bg-[--subtle] rounded-md relative">
                <p className="text-sm font-mono break-all">
                  {data.refreshToken}
                </p>
                <IconButton
                  icon={<BiCopy />}
                  intent="primary-subtle"
                  className="absolute top-1/2 -translate-y-1/2 right-2"
                  onClick={handleCopy}
                  aria-label="Copy authorization code"
                />
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
