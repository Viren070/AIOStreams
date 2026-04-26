'use client';
import { PageWrapper } from '../../shared/page-wrapper';
import { PageControls } from '../../shared/page-controls';
import { FormatterSelection } from './formatter-selection';
import { FormatterPreview } from './formatter-preview';
import { useParentInheritance } from '@/context/userData';
import { InheritedBadge } from '../../shared/inherited-badge';

export function FormatterMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <Content />
    </PageWrapper>
  );
}

function Content() {
  const { isInherited, hasParent } = useParentInheritance();
  return (
    <>
      <div className="flex items-center w-full">
        <div>
          <div className="flex items-center gap-2">
            <h2>Formatter</h2>
            {hasParent && isInherited('formatter') && <InheritedBadge section="formatter" />}
          </div>
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
