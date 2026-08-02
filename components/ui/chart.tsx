'use client'

import * as React from 'react'
import * as RechartsPrimitive from 'recharts'

import { cn } from '@/lib/utils'

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: '', dark: '.dark' } as const

export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
}

type ChartContextProps = {
  config: ChartConfig
}

type ChartTooltipContentProps = React.ComponentProps<
  typeof RechartsPrimitive.Tooltip
> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: 'line' | 'dot' | 'dashed'
    nameKey?: string
    labelKey?: string
  }

type TooltipPayloadItem = NonNullable<ChartTooltipContentProps['payload']>[number]

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />')
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >['children']
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(
    ([, config]) => config.theme || config.color,
  )

  if (!colorConfig.length) {
    return null
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color =
      itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ||
      itemConfig.color
    return color ? `  --color-${key}: ${color};` : null
  })
  .join('\n')}
}
`,
          )
          .join('\n'),
      }}
    />
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

function getPayloadRecord(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  return value as Record<string, unknown>
}

function readStringRecordValue(
  source: Record<string, unknown> | null,
  key: string,
) {
  return source && typeof source[key] === 'string' ? source[key] : null
}

function getTooltipItemKey(
  item: TooltipPayloadItem,
  keyOverride: string | undefined,
) {
  return `${keyOverride || item.name || item.dataKey || 'value'}`
}

function getTooltipLabelKey(
  item: TooltipPayloadItem,
  labelKey: string | undefined,
) {
  return `${labelKey || item.dataKey || item.name || 'value'}`
}

function getTooltipIndicatorColor(
  color: string | undefined,
  item: TooltipPayloadItem,
) {
  if (color) return color

  const payloadRecord = getPayloadRecord(item.payload)
  return typeof payloadRecord?.fill === 'string'
    ? payloadRecord.fill
    : item.color
}

function renderTooltipIndicator({
  hideIndicator,
  indicator,
  indicatorColor,
  itemConfig,
  nestLabel,
}: {
  hideIndicator: boolean
  indicator: 'line' | 'dot' | 'dashed'
  indicatorColor: string | undefined
  itemConfig: ReturnType<typeof getPayloadConfigFromPayload>
  nestLabel: boolean
}) {
  if (itemConfig?.icon) {
    return <itemConfig.icon />
  }

  if (hideIndicator) {
    return null
  }

  return (
    <div
      className={cn(
        'shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)',
        {
          'h-2.5 w-2.5': indicator === 'dot',
          'w-1': indicator === 'line',
          'w-0 border-[1.5px] border-dashed bg-transparent':
            indicator === 'dashed',
          'my-0.5': nestLabel && indicator === 'dashed',
        },
      )}
      style={
        {
          '--color-bg': indicatorColor,
          '--color-border': indicatorColor,
        } as React.CSSProperties
      }
    />
  )
}

function renderTooltipValue(item: TooltipPayloadItem) {
  return item.value ? (
    <span className="text-foreground font-mono font-medium tabular-nums">
      {item.value.toLocaleString()}
    </span>
  ) : null
}

function resolveTooltipLabelValue({
  config,
  item,
  label,
  labelKey,
}: {
  config: ChartConfig
  item: TooltipPayloadItem
  label: ChartTooltipContentProps['label']
  labelKey: string | undefined
}) {
  const key = getTooltipLabelKey(item, labelKey)
  const itemConfig = getPayloadConfigFromPayload(config, item, key)

  if (!labelKey && typeof label === 'string') {
    return config[label as keyof typeof config]?.label || label
  }

  return itemConfig?.label
}

function renderTooltipLabelContent({
  labelClassName,
  labelFormatter,
  payload,
  value,
}: {
  labelClassName: string | undefined
  labelFormatter: ChartTooltipContentProps['labelFormatter']
  payload: NonNullable<ChartTooltipContentProps['payload']>
  value: React.ReactNode
}) {
  if (!value) {
    return null
  }

  if (labelFormatter) {
    return (
      <div className={cn('font-medium', labelClassName)}>
        {labelFormatter(value, payload)}
      </div>
    )
  }

  return <div className={cn('font-medium', labelClassName)}>{value}</div>
}

function buildTooltipLabel({
  config,
  hideLabel,
  label,
  labelClassName,
  labelFormatter,
  labelKey,
  payload,
}: {
  config: ChartConfig
  hideLabel: boolean
  label: ChartTooltipContentProps['label']
  labelClassName: string | undefined
  labelFormatter: ChartTooltipContentProps['labelFormatter']
  labelKey: string | undefined
  payload: ChartTooltipContentProps['payload']
}) {
  if (hideLabel || !payload?.length) {
    return null
  }

  const [item] = payload
  const value = resolveTooltipLabelValue({ config, item, label, labelKey })

  return renderTooltipLabelContent({
    labelClassName,
    labelFormatter,
    payload,
    value,
  })
}

function ChartTooltipRow({
  color,
  config,
  formatter,
  hideIndicator,
  indicator,
  item,
  index,
  nameKey,
  nestLabel,
  tooltipLabel,
}: {
  color: string | undefined
  config: ChartConfig
  formatter: ChartTooltipContentProps['formatter']
  hideIndicator: boolean
  indicator: 'line' | 'dot' | 'dashed'
  item: TooltipPayloadItem
  index: number
  nameKey: string | undefined
  nestLabel: boolean
  tooltipLabel: React.ReactNode
}) {
  const key = getTooltipItemKey(item, nameKey)
  const itemConfig = getPayloadConfigFromPayload(config, item, key)
  const indicatorColor = getTooltipIndicatorColor(color, item)

  return (
    <div
      key={item.dataKey}
      className={cn(
        '[&>svg]:text-muted-foreground flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5',
        indicator === 'dot' && 'items-center',
      )}
    >
      {formatter && item.value !== undefined && item.name ? (
        formatter(item.value, item.name, item, index, item.payload)
      ) : (
        <>
          {renderTooltipIndicator({
            hideIndicator,
            indicator,
            indicatorColor,
            itemConfig,
            nestLabel,
          })}
          <div
            className={cn(
              'flex flex-1 justify-between leading-none',
              nestLabel ? 'items-end' : 'items-center',
            )}
          >
            <div className="grid gap-1.5">
              {nestLabel ? tooltipLabel : null}
              <span className="text-muted-foreground">
                {itemConfig?.label || item.name}
              </span>
            </div>
            {renderTooltipValue(item)}
          </div>
        </>
      )}
    </div>
  )
}

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: ChartTooltipContentProps) {
  const { config } = useChart()

  const tooltipLabel = React.useMemo(
    () =>
      buildTooltipLabel({
        config,
        hideLabel,
        label,
        labelClassName,
        labelFormatter,
        labelKey,
        payload,
      }),
    [config, hideLabel, label, labelClassName, labelFormatter, labelKey, payload],
  )

  if (!active || !payload?.length) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== 'dot'

  return (
    <div
      className={cn(
        'border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload.map((item, index) => (
          <ChartTooltipRow
            key={`${item.dataKey}-${index}`}
            color={color}
            config={config}
            formatter={formatter}
            hideIndicator={hideIndicator}
            indicator={indicator}
            index={index}
            item={item}
            nameKey={nameKey}
            nestLabel={nestLabel}
            tooltipLabel={tooltipLabel}
          />
        ))}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: React.ComponentProps<'div'> &
  Pick<RechartsPrimitive.LegendProps, 'payload' | 'verticalAlign'> & {
    hideIcon?: boolean
    nameKey?: string
  }) {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload.map((item) => {
        const key = `${nameKey || item.dataKey || 'value'}`
        const itemConfig = getPayloadConfigFromPayload(config, item, key)

        return (
          <div
            key={item.value}
            className={
              '[&>svg]:text-muted-foreground flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3'
            }
          >
            {itemConfig?.icon && !hideIcon ? (
              <itemConfig.icon />
            ) : (
              <div
                className="h-2 w-2 shrink-0 rounded-[2px]"
                style={{
                  backgroundColor: item.color,
                }}
              />
            )}
            {itemConfig?.label}
          </div>
        )
      })}
    </div>
  )
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string,
) {
  const payloadRecord = getPayloadRecord(payload)
  if (!payloadRecord) {
    return undefined
  }

  const nestedPayloadRecord = getPayloadRecord(payloadRecord.payload)
  const configLabelKey =
    readStringRecordValue(payloadRecord, key) ??
    readStringRecordValue(nestedPayloadRecord, key) ??
    key

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
}
