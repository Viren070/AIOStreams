import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@aiostreams/ui/card';
import { cn } from '@aiostreams/ui/core/styling';
import React, { useRef, useState } from 'react';

type SettingsCardProps = {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  titleClassName?: string;
  id?: string;
  danger?: boolean;
};

export function SettingsNavCard({ title, children }: SettingsCardProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPosition({ x, y });
  };

  return (
    <div className="pb-4">
      <div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        className="contents lg:block relative group/settings-nav"
        // className=" contents lg:block relative group/settings-nav overflow-hidden"
      >
        {/* <div
                    className="pointer-events-none absolute -inset-px transition-opacity duration-300 opacity-0 group-hover/settings-nav:opacity-100 hidden lg:block"
                    style={{
                        background: `radial-gradient(250px circle at ${position.x}px ${position.y}px, rgb(255 255 255 / 0.025), transparent 40%)`,
                    }}
                 /> */}
        {children}
      </div>
    </div>
  );
}

export const PlainSections = React.createContext(false);
/** The heading of the group a section is in, which the section then doesn't repeat. */
export const SectionGroup = React.createContext<string | null>(null);

function SettingsSection({
  title,
  description,
  children,
  action,
  id,
  danger,
}: SettingsCardProps) {
  if (title === React.useContext(SectionGroup)) title = undefined;
  return (
    <section id={id} data-settings-card className="scroll-mt-24 space-y-2">
      {(title || description || action) && (
        <div className="flex items-end justify-between gap-4 px-1">
          <div className="min-w-0">
            {title && (
              <h3
                className={cn(
                  'text-sm font-semibold',
                  danger ? 'text-red-300' : 'text-gray-100'
                )}
              >
                {title}
              </h3>
            )}
            {description && (
              <div className="mt-0.5 text-xs text-[--muted]">{description}</div>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div
        className={cn(
          'space-y-3 rounded-xl border p-4',
          danger
            ? 'border-red-500/30 bg-red-950/20'
            : 'border-[--border] bg-gray-950/50'
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** Edge-to-edge rows in a plain section, else the given grid. */
export function SettingsRows({
  children,
  grid,
}: {
  children: React.ReactNode;
  grid: string;
}) {
  return React.useContext(PlainSections) ? (
    <div className="-m-4 divide-y divide-[--border]">{children}</div>
  ) : (
    <div className={grid}>{children}</div>
  );
}

export function SettingsCard(props: SettingsCardProps) {
  return React.useContext(PlainSections) ? (
    <SettingsSection {...props} />
  ) : (
    <CardLook {...props} />
  );
}

function CardLook({
  title,
  description,
  children,
  className,
  titleClassName,
  action,
  id,
  danger,
}: SettingsCardProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setPosition({ x, y });
  };

  return (
    <>
      <Card
        ref={cardRef}
        id={id}
        data-settings-card
        className={cn(
          'group/settings-card relative lg:bg-gray-950/70 scroll-mt-24',
          danger && 'lg:bg-red-700/70 border-red-500/20',
          className
        )}
        onMouseMove={handleMouseMove}
      >
        {title && (
          <CardHeader className="p-0 pb-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <CardTitle
                  className={cn(
                    'font-bold tracking-widest uppercase text-sm transition-colors duration-300 group-hover/settings-card:text-white group-hover/settings-card:from-brand-500/10 group-hover/settings-card:to-purple-500/5 px-4 py-2 border bg-transparent bg-gradient-to-br bg-[--subtle] border-t-0 border-l-0 w-fit rounded-tl-md rounded-br-md',
                    danger &&
                      'group-hover/settings-card:from-red-500/10 group-hover/settings-card:to-red-700/20',
                    titleClassName
                  )}
                >
                  {title}
                </CardTitle>
                {description && (
                  <CardDescription className="px-4 mt-2">
                    {description}
                  </CardDescription>
                )}
              </div>
              {action && (
                <div className="flex-shrink-0 px-4 pt-2">{action}</div>
              )}
            </div>
          </CardHeader>
        )}
        <CardContent className={cn(!title && 'pt-4', 'space-y-3 flex-wrap')}>
          {children}
        </CardContent>
      </Card>
    </>
  );
}

export function SettingsPageHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="p-2 rounded-lg bg-gradient-to-br from-brand-500/20 to-purple-500/20 border border-brand-500/20">
        <Icon className="text-2xl text-brand-600 dark:text-brand-400" />
      </div>
      <div>
        <h3 className="text-xl font-semibold">{title}</h3>
        <p className="text-base text-[--muted]">{description}</p>
      </div>
    </div>
  );
}
