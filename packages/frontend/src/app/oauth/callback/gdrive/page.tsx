'use client';

import { ThemeProvider } from 'next-themes';
import { useEffect, useState } from 'react';
import { LoadingOverlay } from '@/components/ui/loading-spinner';
import { TextGenerateEffect } from '@/components/shared/text-generate-effect';
import { LuffyError } from '@/components/shared/luffy-error';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/button';
import { Toaster } from '@/components/ui/toaster';
import { toast } from 'sonner';
import { exchangeGDriveCode } from '@/lib/api';
import { BiCopy } from 'react-icons/bi';
import { copyToClipboard } from '@/utils/clipboard';

function OAuthCallbackContent() {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      // Get the code from URL search params
      const searchParams = new URLSearchParams(window.location.search);
      const authCode = searchParams.get('code');
      const errorParam = searchParams.get('error');

      if (errorParam) {
        setError(errorParam);
      } else if (authCode) {
        try {
          const response = await exchangeGDriveCode(authCode);
          setCode(response.refreshToken);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to exchange GDrive auth code'
          );
        }
      } else {
        setError('No authorization code found in URL');
      }
      setLoading(false);
    };
    fetchData();
  }, []);

  const handleCopy = async () => {
    if (code) {
      await copyToClipboard(code, {
        successMessage: 'Copied!',
        errorMessage: 'Failed to copy',
        description:
          'The authorization code has been copied to your clipboard.',
      });
    }
  };

  if (loading) {
    return (
      <LoadingOverlay showSpinner>
        <TextGenerateEffect
          words="Processing OAuth callback..."
          className="text-2xl"
        />
      </LoadingOverlay>
    );
  }

  if (error) {
    return (
      <LoadingOverlay showSpinner={false}>
        <LuffyError title="OAuth Error" showRefreshButton>
          <p>{error}</p>
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
          {code && (
            <div className="relative">
              <div className="p-4 pr-12 bg-[--subtle] rounded-md relative">
                <p className="text-sm font-mono break-all">{code}</p>
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
      <Toaster />
    </div>
  );
}

export default function OAuthCallback() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark">
      <OAuthCallbackContent />
    </ThemeProvider>
  );
}
