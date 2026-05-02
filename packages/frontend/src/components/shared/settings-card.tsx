import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/components/ui/core/styling';
import React, { useRef, useState } from 'react';

type SettingsCardProps = {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
  titleClassName?: string;
  id?: string;
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
        className="lg:p-2 lg:border lg:rounded-[--radius] lg:bg-gray-950/70 contents lg:block relative group/settings-nav"
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

export function SettingsCard({
  title,
  description,
  children,
  className,
  titleClassName,
  action,
  id,
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
          'data-[command-target=true]:ring-2 data-[command-target=true]:ring-brand-500 data-[command-target=true]:ring-offset-2 data-[command-target=true]:ring-offset-[--background] transition-shadow',
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
