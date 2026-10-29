import { useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

import { Card, Text } from '@/components/ui';
import { useTheme } from '@/hooks/useTheme';
import { shortDate, type Point } from '@/lib/progress/series';

type Props = {
  points: Point[];
  /** Formats a value for the summary line and the y-axis, e.g. "100 kg". */
  format: (v: number) => string;
  formatAxis?: (v: number) => string;
  title?: string;
  emptyText?: string;
  height?: number;
};

const Y_AXIS_WIDTH = 44;
const INITIAL_SPACING = 8;
const MAX_LABELS = 5;
const LABEL_WIDTH = 48;

/**
 * Line chart (react-native-gifted-charts, drawn with react-native-svg, so it
 * renders as SVG on web). Measures its own width so it fits a 390 px phone
 * and the 600 px web column. Tap or drag across the chart to see a point's
 * value. Selection uses our own responder overlay instead of the library's
 * focus feature: that one puts onPressIn on SVG shapes, which does nothing on
 * web and makes react-native-web log unknown-prop warnings.
 */
export function LineChartCard({
  points,
  format,
  formatAxis,
  title,
  emptyText = 'No data yet.',
  height = 180,
}: Props) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));
  const shown = focused !== null ? points[focused] : points.at(-1);

  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Pad the y range so a flat line isn't glued to the axis.
  const pad = max === min ? Math.max(1, max * 0.05) : (max - min) * 0.15;
  const offset = Math.max(0, Math.floor(min - pad));
  const span = Math.max(1, Math.ceil(max + pad) - offset);

  const plotWidth = Math.max(0, width - Y_AXIS_WIDTH - 24);
  // The svg is plotWidth wide, so the padding at both ends has to fit inside it.
  const inner = Math.max(0, plotWidth - 2 * INITIAL_SPACING);
  const spacing = points.length > 1 ? inner / (points.length - 1) : inner;
  const labelEvery = Math.max(1, Math.ceil(points.length / MAX_LABELS));
  const last = points.length - 1;
  // Every n-th date plus the last one, skipping one that would crowd the last.
  const hasLabel = (i: number) => i === last || (i % labelEvery === 0 && last - i >= labelEvery);
  // Labels are wider than the gap between points: centre them on the point,
  // except at the ends, where they'd be cut off by the edge of the chart.
  const labelStyle = (i: number) => {
    const base = { color: theme.colors.textMuted, fontSize: 10, width: LABEL_WIDTH };
    if (i === 0 && last > 0)
      return { ...base, textAlign: 'left' as const, marginLeft: spacing / 2 - INITIAL_SPACING };
    if (i === last && last > 0)
      return {
        ...base,
        textAlign: 'right' as const,
        marginLeft: spacing / 2 + INITIAL_SPACING - LABEL_WIDTH,
      };
    return { ...base, marginLeft: (spacing - LABEL_WIDTH) / 2 };
  };
  const data = points.map((p, i) => ({
    value: p.value - offset,
    label: hasLabel(i) ? shortDate(p.date) : '',
    labelTextStyle: labelStyle(i),
    ...(i === focused
      ? {
          dataPointRadius: 6,
          showStrip: true,
          stripHeight: height,
          stripWidth: 1,
          stripColor: theme.colors.textMuted,
        }
      : null),
  }));

  const select = (e: GestureResponderEvent) => {
    if (points.length === 0) return;
    const x = e.nativeEvent.locationX - INITIAL_SPACING;
    const i = points.length > 1 ? Math.round(x / spacing) : 0;
    setFocused(Math.min(points.length - 1, Math.max(0, i)));
  };

  return (
    <Card>
      {title ? <Text variant="label">{title}</Text> : null}
      {shown ? (
        <View style={styles.summary} accessibilityLiveRegion="polite">
          <Text variant="heading">{format(shown.value)}</Text>
          <Text variant="caption" color="textMuted">
            {focused !== null ? shortDate(shown.date) : `Latest · ${shortDate(shown.date)}`}
          </Text>
        </View>
      ) : null}
      <View
        testID="chart-area"
        onLayout={onLayout}
        style={{ minHeight: points.length ? height + 30 : 0 }}
      >
        {points.length === 0 ? (
          <Text color="textMuted">{emptyText}</Text>
        ) : width > 0 ? (
          <View>
            <LineChart
              data={data}
              width={plotWidth}
              height={height}
              spacing={spacing}
              initialSpacing={INITIAL_SPACING}
              endSpacing={8}
              maxValue={span}
              noOfSections={4}
              yAxisLabelWidth={Y_AXIS_WIDTH}
              formatYLabel={(l) => (formatAxis ?? format)(Number(l) + offset)}
              yAxisTextStyle={{ color: theme.colors.textMuted, fontSize: 10 }}
              color={theme.colors.primary}
              thickness={2.5}
              dataPointsColor={theme.colors.primary}
              dataPointsRadius={points.length > 40 ? 0 : 3.5}
              areaChart
              startFillColor={theme.colors.primary}
              endFillColor={theme.colors.primary}
              startOpacity={0.25}
              endOpacity={0.02}
              rulesColor={theme.colors.border}
              rulesType="solid"
              yAxisColor={theme.colors.border}
              xAxisColor={theme.colors.border}
              disableScroll
              isAnimated={false}
            />
            <View
              testID="chart-scrub"
              style={[styles.scrub, { left: Y_AXIS_WIDTH, width: plotWidth, height }]}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={select}
              onResponderMove={select}
            />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  scrub: { position: 'absolute', top: 0 },
});
