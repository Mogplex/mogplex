'use client'

import * as React from 'react'
import type * as RechartsPrimitive from 'recharts'

import { cn } from '@/lib/utils'
import type { ChartConfig } from './chart'

export type ChartTooltipContentProps = React.ComponentProps<
  typeof RechartsPrimitive.Tooltip
> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: 'line' | 'dot' | 'dashed'
    nameKey?: string
    labelKey?: string
  }

export type TooltipPayloadItem = NonNullable<ChartTooltipContentProps['payload']>[number]

export function getPayloadRecord(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  return value as Record<string, unknown>
}

export function readStringRecordValue(
  source: Record<string, unknown> | null,
  key: string,
) {
  return source && typeof source[key] === 'string' ? source[key] : null
}

export function getTooltipItemKey(
  item: TooltipPayloadItem,
  keyOverride: string | undefined,
) {
  return `${keyOverride || item.name || item.dataKey || 'value'}`
}

export function getTooltipLabelKey(
  item: TooltipPayloadItem,
  labelKey: string | undefined,
) {
  return `${labelKey || item.dataKey || item.name || 'value'}`
}

export function getTooltipIndicatorColor(
  color: string | undefined,
  item: TooltipPayloadItem,
) {
  if (color) return color

  const payloadRecord = getPayloadRecord(item.payload)
  return typeof payloadRecord?.fill === 'string'
    ? payloadRecord.fill
    : item.color
}

export function getPayloadConfigFromPayload(
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

export function renderTooltipIndicator({
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

export function renderTooltipValue(item: TooltipPayloadItem) {
  return item.value ? (
    <span className="text-foreground font-mono font-medium tabular-nums">
      {item.value.toLocaleString()}
    </span>
  ) : null
}

export function resolveTooltipLabelValue({
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

export function renderTooltipLabelContent({
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

export function buildTooltipLabel({
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

export function ChartTooltipRow({
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
