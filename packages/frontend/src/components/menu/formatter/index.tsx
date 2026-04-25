'use client';
import { PageWrapper } from '../../shared/page-wrapper';
import { PageControls } from '../../shared/page-controls';
import { FormatterSelection } from './formatter-selection';
import { FormatterPreview } from './formatter-preview';

export function FormatterMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <h2>Formatter</h2>
          <p className="text-[--muted]">Format your streams to your liking.</p>
        </div>
        <div className="hidden lg:block lg:ml-auto">
          <PageControls />
        </div>
      </div>
      <FormatterSelection />
      <FormatterPreview />
    </>
  );
}
