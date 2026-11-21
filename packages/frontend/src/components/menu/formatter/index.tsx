import { PageWrapper } from '../../shared/page-wrapper';
import { MenuHeader } from '../../shared/menu-header';
import { FormatterSelection } from './formatter-selection';
import { FormatterPreview } from './preview';
import { useParentInheritance } from '@/context/userData';
import { InheritedBadge } from '../../shared/inherited-badge';

export function FormatterMenu() {
  return (
    <PageWrapper className="space-y-4 p-4 sm:p-8">
      <FormatterContent />
    </PageWrapper>
  );
}

export function FormatterContent() {
  const { isInherited, hasParent } = useParentInheritance();
  return (
    <>
      <MenuHeader
        title="Formatter"
        description="Format your streams to your liking."
        badge={
          hasParent &&
          isInherited('formatter') && <InheritedBadge section="formatter" />
        }
      />
      <FormatterSelection />
      <FormatterPreview />
    </>
  );
}
