import * as React from 'react';

type ExtendedProps<Props = {}, OverrideProps = {}> = OverrideProps &
  Omit<Props, keyof OverrideProps>;
type ElementType = React.ElementType;
type PropsOf<C extends ElementType> = React.JSX.LibraryManagedAttributes<
  C,
  React.ComponentPropsWithoutRef<C>
>;
type ComponentProp<C extends ElementType> = {
  component?: C;
};
type InheritedProps<C extends ElementType, Props = {}> = ExtendedProps<
  PropsOf<C>,
  Props
>;
export type PolymorphicRef<C> = C extends React.ElementType
  ? React.ComponentPropsWithRef<C>['ref']
  : never;
export type PolymorphicComponentProps<
  C,
  Props = {},
> = C extends React.ElementType
  ? InheritedProps<C, Props & ComponentProp<C>> & { ref?: PolymorphicRef<C> }
  : Props & { component: React.ElementType };

export function createPolymorphicComponent<
  ComponentDefaultType extends React.ElementType,
  Props,
  StaticComponents = Record<string, never>,
>(component: any) {
  type ComponentProps<C extends React.ElementType> = PolymorphicComponentProps<
    C,
    Props
  >;

  type _PolymorphicComponent = <
    C extends React.ElementType = ComponentDefaultType,
  >(
    props: ComponentProps<C>
  ) => React.ReactElement | null;

  type ComponentProperties = Omit<
    React.FunctionComponent<ComponentProps<any>>,
    never
  >;

  type PolymorphicComponent = _PolymorphicComponent &
    ComponentProperties &
    StaticComponents;

  return component as PolymorphicComponent;
}
