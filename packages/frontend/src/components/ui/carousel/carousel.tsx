import { cva } from 'class-variance-authority';
import useEmblaCarousel, {
  type UseEmblaCarouselType,
} from 'embla-carousel-react';
import * as React from 'react';
import { IconButton } from '../button';
import { cn, defineStyleAnatomy } from '../core/styling';

/* -------------------------------------------------------------------------------------------------
 * Anatomy
 * -----------------------------------------------------------------------------------------------*/

export const CarouselAnatomy = defineStyleAnatomy({
  root: cva(['UI-Carousel__root', 'relative']),
  content: cva(['UI-Carousel__content', 'overflow-hidden']),
  innerContent: cva(['UI-Carousel__innerContent', 'flex'], {
    variants: {
      gap: { none: 'ml-0', sm: '-ml-2', md: '-ml-4', lg: '-ml-6' },
    },
  }),
  item: cva(['UI-Carousel__item', 'min-w-0 shrink-0 grow-0 basis-full'], {
    variants: {
      gap: { none: 'pl-0', sm: 'pl-2', md: 'pl-4', lg: 'pl-6' },
    },
  }),
  chevronIcon: cva(['UI-Carousel__chevronIcon', 'size-6']),
});

/* -------------------------------------------------------------------------------------------------
 * Carousel
 * -----------------------------------------------------------------------------------------------*/

export type CarouselApi = UseEmblaCarouselType[1];
type EmblaApi = NonNullable<CarouselApi>;
export type CarouselOptions = Parameters<typeof useEmblaCarousel>[0];

type CarouselGap = 'none' | 'sm' | 'md' | 'lg';

type CarouselContextProps = {
  carouselRef: UseEmblaCarouselType[0];
  api: CarouselApi;
  gap: CarouselGap;
  scrollPrev: () => void;
  scrollNext: () => void;
  canScrollPrev: boolean;
  canScrollNext: boolean;
};

const CarouselContext = React.createContext<CarouselContextProps | null>(null);

export function useCarousel() {
  const context = React.useContext(CarouselContext);
  if (!context) {
    throw new Error('useCarousel must be used within a <Carousel />');
  }
  return context;
}

/**
 * Embla re-initialises whenever slides are added and restarts at the nearest
 * snap; this puts a row that grew mid-drag back where it was.
 */
function useKeepPositionOnReInit(api: CarouselApi) {
  React.useEffect(() => {
    if (!api) return;
    let saved: number | null = null;
    const remember = (emblaApi: EmblaApi) => {
      saved = emblaApi.internalEngine().location.get();
    };
    const restore = (emblaApi: EmblaApi) => {
      if (saved === null) return;
      const engine = emblaApi.internalEngine();
      const at = engine.limit.constrain(saved);
      for (const vector of [
        engine.location,
        engine.offsetLocation,
        engine.previousLocation,
        engine.target,
      ]) {
        vector.set(at);
      }
      engine.translate.to(at);
    };
    api.on('scroll', remember);
    api.on('settle', remember);
    api.on('reInit', restore);
    return () => {
      api.off('scroll', remember);
      api.off('settle', remember);
      api.off('reInit', restore);
    };
  }, [api]);
}

export type CarouselProps = React.HTMLAttributes<HTMLDivElement> & {
  opts?: CarouselOptions;
  gap?: CarouselGap;
};

export const Carousel = React.forwardRef<HTMLDivElement, CarouselProps>(
  (props, ref) => {
    const { opts, gap = 'md', className, children, ...rest } = props;

    const [carouselRef, api] = useEmblaCarousel({ ...opts, axis: 'x' });
    const [canScrollPrev, setCanScrollPrev] = React.useState(false);
    const [canScrollNext, setCanScrollNext] = React.useState(false);
    useKeepPositionOnReInit(api);

    const onSelect = React.useCallback((emblaApi: EmblaApi) => {
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());
    }, []);

    const scrollPrev = React.useCallback(() => api?.scrollPrev(), [api]);
    const scrollNext = React.useCallback(() => api?.scrollNext(), [api]);

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          scrollPrev();
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          scrollNext();
        }
      },
      [scrollPrev, scrollNext]
    );

    React.useEffect(() => {
      if (!api) return;
      onSelect(api);
      api.on('reInit', onSelect);
      api.on('select', onSelect);
      api.on('scroll', onSelect);
      return () => {
        api.off('reInit', onSelect);
        api.off('select', onSelect);
        api.off('scroll', onSelect);
      };
    }, [api, onSelect]);

    return (
      <CarouselContext.Provider
        value={{
          carouselRef,
          api,
          gap,
          scrollPrev,
          scrollNext,
          canScrollPrev,
          canScrollNext,
        }}
      >
        <div
          ref={ref}
          onKeyDownCapture={handleKeyDown}
          className={cn(CarouselAnatomy.root(), className)}
          role="region"
          aria-roledescription="carousel"
          {...rest}
        >
          {children}
        </div>
      </CarouselContext.Provider>
    );
  }
);
Carousel.displayName = 'Carousel';

/* -------------------------------------------------------------------------------------------------
 * CarouselContent
 * -----------------------------------------------------------------------------------------------*/

export type CarouselContentProps = React.ComponentPropsWithoutRef<'div'> & {
  contentClass?: string;
};

export const CarouselContent = React.forwardRef<
  HTMLDivElement,
  CarouselContentProps
>((props, ref) => {
  const { className, contentClass, ...rest } = props;
  const { carouselRef, gap } = useCarousel();

  return (
    <div
      ref={carouselRef}
      className={cn(CarouselAnatomy.content(), contentClass)}
    >
      <div
        ref={ref}
        className={cn(CarouselAnatomy.innerContent({ gap }), className)}
        {...rest}
      />
    </div>
  );
});
CarouselContent.displayName = 'CarouselContent';

/* -------------------------------------------------------------------------------------------------
 * CarouselItem
 * -----------------------------------------------------------------------------------------------*/

export const CarouselItem = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<'div'>
>((props, ref) => {
  const { className, ...rest } = props;
  const { gap } = useCarousel();

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="slide"
      className={cn(CarouselAnatomy.item({ gap }), className)}
      {...rest}
    />
  );
});
CarouselItem.displayName = 'CarouselItem';

/* -------------------------------------------------------------------------------------------------
 * CarouselPrevious / CarouselNext
 * -----------------------------------------------------------------------------------------------*/

export type CarouselButtonProps = React.ComponentProps<typeof IconButton> & {
  chevronIconClass?: string;
};

function Chevron({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(CarouselAnatomy.chevronIcon(), className)}
    >
      <path d={path} />
    </svg>
  );
}

export const CarouselPrevious = React.forwardRef<
  HTMLButtonElement,
  CarouselButtonProps
>((props, ref) => {
  const {
    className,
    chevronIconClass,
    intent = 'gray-subtle',
    ...rest
  } = props;
  const { scrollPrev, canScrollPrev } = useCarousel();

  return (
    <IconButton
      ref={ref}
      intent={intent}
      size="sm"
      className={cn('rounded-full', className)}
      disabled={!canScrollPrev}
      onClick={scrollPrev}
      aria-label="Previous"
      icon={<Chevron path="m15 18-6-6 6-6" className={chevronIconClass} />}
      {...rest}
    />
  );
});
CarouselPrevious.displayName = 'CarouselPrevious';

export const CarouselNext = React.forwardRef<
  HTMLButtonElement,
  CarouselButtonProps
>((props, ref) => {
  const {
    className,
    chevronIconClass,
    intent = 'gray-subtle',
    ...rest
  } = props;
  const { scrollNext, canScrollNext } = useCarousel();

  return (
    <IconButton
      ref={ref}
      intent={intent}
      size="sm"
      className={cn('rounded-full', className)}
      disabled={!canScrollNext}
      onClick={scrollNext}
      aria-label="Next"
      icon={<Chevron path="m9 18 6-6-6-6" className={chevronIconClass} />}
      {...rest}
    />
  );
});
CarouselNext.displayName = 'CarouselNext';
