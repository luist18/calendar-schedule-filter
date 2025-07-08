# Calendar Schedule Filter

A Cloudflare Worker that filters iCalendar feeds (like PagerDuty schedules) based on keywords and regex patterns. Perfect for creating custom calendar views that show only relevant on-call events.

## Features

- 🎯 **Dynamic Target Calendars**: Works with any webcal:// or https:// calendar URL
- 🔍 **Flexible Filtering**: Include/exclude events by keywords or regex patterns
- ⚡ **Fast & Reliable**: Powered by Cloudflare Workers edge network
- 🔒 **Secure**: URL validation prevents malicious requests
- 📱 **Calendar Compatible**: Works with any calendar app that supports iCal feeds

## Quick Start

### 1. Deploy to Cloudflare Workers

```bash
# Clone the repository
git clone luist18/calendar-schedule-filter
cd calendar-schedule-filter

# Install dependencies
bun install

# Deploy to Cloudflare Workers
bun wrangler deploy
```

### 2. Basic Usage

Once deployed, your worker will be available at:
```
https://your-worker-name.your-subdomain.workers.dev/
```

**Important**: All calendar URLs must be URL-encoded when passed as parameters.

### 3. URL Encoding

Since calendar URLs contain special characters (`://`), they must be encoded:

**JavaScript:**
```javascript
const calendarUrl = 'webcal://company.pagerduty.com/feed/abc123';
const encodedUrl = encodeURIComponent(calendarUrl);
// Result: webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123
```

**Online Tool:** Use [urlencoder.org](https://www.urlencoder.org/) for manual encoding.

## Usage Examples

### Basic Calendar Filtering

```
# Get your PagerDuty calendar URL (usually starts with webcal://)
Original: webcal://company.pagerduty.com/feed/abc123

# URL encode it
Encoded: webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123

# Use with the worker
https://your-worker.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123
```

### Filter Out Secondary On-Call Events

```
https://your-worker.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&exclude=Secondary
```

### Show Only Primary On-Call Events

```
https://your-worker.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&include=Primary
```

### Show Only Specific Teams

```
https://your-worker.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&include=TeamA,TeamB
```

### Complex Filtering with Regex

```
# Show only events matching "Primary.*OnCall" pattern
https://your-worker.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&includePattern=Primary.*OnCall

# Exclude events matching "Secondary.*OnCall" pattern
https://your-worker.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&excludePattern=Secondary.*OnCall
```

### Combine Multiple Filters

```
# Show TeamA events but exclude Secondary ones
https://your-worker.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&include=TeamA&exclude=Secondary
```

## Filter Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `targetCalendar` | **Required.** The source calendar URL (URL-encoded) | `webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123` |
| `include` | Comma-separated keywords to include | `Primary,TeamA` |
| `exclude` | Comma-separated keywords to exclude | `Secondary,Backup` |
| `includePattern` | Regex pattern for events to include | `Primary.*OnCall` |
| `excludePattern` | Regex pattern for events to exclude | `Secondary.*OnCall` |

## Filter Logic

1. **Include filters** (if specified): Event must match at least one include keyword OR pattern
2. **Exclude filters** (if specified): Event must NOT match any exclude keyword OR pattern
3. **No filters**: All events are included

## JavaScript Helper Function

```javascript
function createFilteredCalendarUrl(baseWorkerUrl, calendarUrl, filters = {}) {
  const url = new URL(baseWorkerUrl);

  // Add required target calendar
  url.searchParams.set('targetCalendar', calendarUrl);

  // Add optional filters
  if (filters.include) url.searchParams.set('include', filters.include);
  if (filters.exclude) url.searchParams.set('exclude', filters.exclude);
  if (filters.includePattern) url.searchParams.set('includePattern', filters.includePattern);
  if (filters.excludePattern) url.searchParams.set('excludePattern', filters.excludePattern);

  return url.toString();
}

// Usage
const filteredUrl = createFilteredCalendarUrl(
  'https://your-worker.workers.dev/',
  'webcal://company.pagerduty.com/feed/abc123',
  {
    include: 'Primary,TeamA',
    exclude: 'Secondary'
  }
);
```

## Development

### Local Development

```bash
# Install dependencies
bun install

# Run tests
bun test

# Start local development server
bunx wrangler dev
```

## Limitations

- Calendar updates are cached for 5 minutes for performance
- Only supports `webcal://` and `https://` calendar URLs
- Regex patterns use JavaScript regex syntax

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

