import React from 'react';
import { PageWrapper } from '../shared/page-wrapper';
import { SettingsCard } from '../shared/settings-card';
import { Switch } from '../ui/switch';
import { useUserData } from '@/context/userData';
import { PageControls } from '../shared/page-controls';

export function OptionsMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { userData, setUserData } = useUserData();
  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <div className="flex items-center gap-2">
            <h2>Options</h2>
          </div>
          <p className="text-[--muted]">{':)'}</p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>

      <SettingsCard title="Fun" className="w-full">
        <div className="flex flex-col gap-4">
          <Switch
            label="Randomise results"
            side="right"
            value={userData.randomiseResults}
            onValueChange={(value) =>
              setUserData((prev) => ({
                ...prev,
                randomiseResults: value,
              }))
            }
          />
          <Switch
            label="Enhance results"
            side="right"
            value={userData.enhanceResults}
            onValueChange={(value) =>
              setUserData((prev) => ({
                ...prev,
                enhanceResults: value,
              }))
            }
          />
          <Switch
            label="Enhance posters"
            side="right"
            value={userData.enhancePosters}
            onValueChange={(value) =>
              setUserData((prev) => ({
                ...prev,
                enhancePosters: value,
              }))
            }
          />
        </div>
      </SettingsCard>
    </>
  );
}
