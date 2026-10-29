import { render, screen } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';

import { Button, Card } from '@/components/ui';
import { findNestedPressables } from '@/test-utils/nesting';

const root = () => screen.root as never;

describe('findNestedPressables', () => {
  it('flags a pressable inside a pressable', async () => {
    await render(
      <Card onPress={() => {}} accessibilityLabel="Outer">
        <Button title="Inner" onPress={() => {}} />
      </Card>,
    );
    expect(findNestedPressables(root())).toEqual([expect.stringContaining('inside View "Outer"')]);
    await render(<View />); // leave a clean tree for the global after-each check
  });

  it('flags pressable text inside a pressable', async () => {
    await render(
      <Pressable onPress={() => {}}>
        <Text onPress={() => {}}>link</Text>
      </Pressable>,
    );
    expect(findNestedPressables(root())).toHaveLength(1);
    await render(<View />);
  });

  it('allows sibling pressables', async () => {
    await render(
      <View>
        <Pressable onPress={() => {}}>
          <Text>row</Text>
        </Pressable>
        <Pressable onPress={() => {}}>
          <Text>info</Text>
        </Pressable>
      </View>,
    );
    expect(findNestedPressables(root())).toEqual([]);
  });
});
