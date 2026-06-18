# CareRecord UI system

CareRecord uses MUI v7 with semantic tokens from `src/theme.ts`. New product UI must use the exports from `src/components/ui` when a matching component exists.

## Conventions

- Use `AppButton` for actions. `primary` is the main action, `secondary` is supporting, and `danger` is destructive.
- Use `AppTextField`, `NumberField`, `DateTimeField`, and `SelectField` for labelled inputs.
- Use `MultiSelectField`, `CheckboxGroupField`, and `RadioGroupField` for choices. Each input must have a visible label and error text where validation can fail.
- Use `ConfirmProvider` for two-action confirmations and `AppDialog` for workflows with custom actions.
- Use `PageContainer`, `PageHeader`, `SectionCard`, `DataTable`, `EmptyState`, and `StatusChip` for page structure.
- Use theme keys such as `background.default`, `background.subtle`, `background.tint`, `background.danger`, and `divider`; do not add product colors as literals.
- Show transient operation results in a toast, field validation next to the field, and persistent system state in an alert.
- Use MUI `slotProps` rather than deprecated `InputProps`, `InputLabelProps`, or component-specific `*Props` APIs in new code.

## Allowed direct MUI usage

Direct MUI composition remains appropriate for layout primitives (`Box`, `Stack`, `Typography`), tables with highly specialized cells, navigation, tabs, icon buttons, and third-party integrations. Hidden native file inputs, FullCalendar styling, and React PDF components are explicit exceptions.

Every reusable component state is documented in Storybook. Run `npm run storybook` for development or `npm run build-storybook` as a validation gate.

