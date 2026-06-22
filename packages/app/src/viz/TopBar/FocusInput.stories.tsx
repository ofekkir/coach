import type { Story, StoryDefault } from '@ladle/react';

import { FocusInput } from './FocusInput.tsx';

export default {
  title: 'viz/TopBar/FocusInput',
} satisfies StoryDefault;

// Resolving id: type anything and press Enter — onFocus returns true, the field
// stays neutral.
export const Default: Story = () => <FocusInput onFocus={() => true} />;

// Unknown id: type anything and press Enter — onFocus returns false, the border
// and text flip to the accent. Clearing or editing resets the error.
export const NotFound: Story = () => <FocusInput onFocus={() => false} />;
