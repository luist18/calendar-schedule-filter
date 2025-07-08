// Cloudflare Worker to parse and filter iCalendar feed
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		// Get target calendar URL from query params or use default
		const targetCalendarParam = url.searchParams.get('targetCalendar');
		if (!targetCalendarParam) {
			return new Response('Missing targetCalendar parameter. Usage: ?targetCalendar=webcal://your-calendar-url', { status: 400 });
		}

		// Validate and convert the target calendar URL
		const originalFeedUrl = validateAndConvertWebcalUrl(targetCalendarParam);
		if (!originalFeedUrl) {
			return new Response('Invalid calendar URL. Must be a valid webcal:// or https:// URL', { status: 400 });
		}

		// Parse filter rules from query params
		const filterRules = parseFilterRules(url.searchParams);

		try {
			// Fetch the original iCal feed
			const response = await fetch(originalFeedUrl);
			if (!response.ok) {
				return new Response(`Failed to fetch calendar: ${response.status} ${response.statusText}`, { status: 502 });
			}
			const icalText = await response.text();

			// Parse and filter the iCal
			const filteredIcal = filterICalendar(icalText, filterRules);

			return new Response(filteredIcal, {
				headers: {
					'Content-Type': 'text/calendar; charset=utf-8',
					'Cache-Control': 'max-age=300', // Cache for 5 minutes
				},
			});
		} catch (error) {
			return new Response('Error processing calendar feed', { status: 500 });
		}
	},
};

type Event = {
	summary: string;
	dtstart: string;
	dtend: string;
	uid: string;
	raw: string[];
};

// Convert webcal:// URL to https://
function convertWebcalToHttps(webcalUrl: string) {
	if (webcalUrl.startsWith('webcal://')) {
		return webcalUrl.replace('webcal://', 'https://');
	}
	return webcalUrl;
}

// Validate and convert a potentially webcal:// URL to a https:// URL
function validateAndConvertWebcalUrl(urlString: string): string | null {
	try {
		// Basic validation - must start with webcal:// or https://
		if (urlString.startsWith('webcal://')) {
			const httpsUrl = convertWebcalToHttps(urlString);
			// Validate it's a proper URL
			new URL(httpsUrl);
			return httpsUrl;
		}
		if (urlString.startsWith('https://')) {
			// Validate it's a proper URL
			new URL(urlString);
			return urlString;
		}
		return null;
	} catch {
		// Invalid URL format
		return null;
	}
}

// Parse filter rules from query parameters
function parseFilterRules(searchParams: URLSearchParams): FilterRules {
	const rules: FilterRules = {
		exclude: [],
		include: [],
		excludePatterns: [],
		includePatterns: [],
	};

	// ?exclude=TeamB,Secondary
	if (searchParams.has('exclude')) {
		rules.exclude = searchParams
			.get('exclude')
			?.split(',')
			.map((s) => s.trim()) ?? [];
	}

	// ?include=Primary,TeamA
	if (searchParams.has('include')) {
		rules.include = searchParams
			.get('include')
			?.split(',')
			.map((s) => s.trim()) ?? [];
	}

	// ?excludePattern=Secondary.*OnCall
	if (searchParams.has('excludePattern')) {
		rules.excludePatterns = searchParams
			.get('excludePattern')
			?.split(',')
			.map((s) => new RegExp(s.trim(), 'i')) ?? [];
	}

	// ?includePattern=Primary.*OnCall
	if (searchParams.has('includePattern')) {
		rules.includePatterns = searchParams
			.get('includePattern')
			?.split(',')
			.map((s) => new RegExp(s.trim(), 'i')) ?? [];
	}

	return rules;
}

// Simple iCalendar parser
function parseICalendar(icalText: string) {
	const lines = icalText.split('\n').map((line) => line.trim());
	const events: Event[] = [];
	let currentEvent: Event | null = null;
	let inEvent = false;

	for (const line of lines) {
		if (line === 'BEGIN:VEVENT') {
			inEvent = true;
			currentEvent = { raw: [line], summary: '', dtstart: '', dtend: '', uid: '' };
		} else if (line === 'END:VEVENT') {
			inEvent = false;
			if (currentEvent) {
				currentEvent.raw.push(line);
				events.push(currentEvent);
			}
			currentEvent = null;
		} else if (inEvent && currentEvent) {
			currentEvent.raw.push(line);

			// Parse key fields
			if (line.startsWith('SUMMARY:')) {
				currentEvent.summary = line.substring(8);
			} else if (line.startsWith('DTSTART')) {
				currentEvent.dtstart = line;
			} else if (line.startsWith('DTEND')) {
				currentEvent.dtend = line;
			} else if (line.startsWith('UID:')) {
				currentEvent.uid = line.substring(4);
			}
		}
	}

	return events;
}

type FilterRules = {
	exclude: string[];
	include: string[];
	excludePatterns: RegExp[];
	includePatterns: RegExp[];
};

// Filter events based on rules
function shouldIncludeEvent(event: Event, rules: FilterRules) {
	const summary = event.summary || '';

	// If include rules are specified, event must match at least one
	if (rules.include.length > 0) {
		const matchesInclude = rules.include.some((keyword) => summary.toLowerCase().includes(keyword.toLowerCase()));
		if (!matchesInclude) return false;
	}

	// If includePatterns are specified, event must match at least one
	if (rules.includePatterns.length > 0) {
		const matchesIncludePattern = rules.includePatterns.some((pattern) => pattern.test(summary));
		if (!matchesIncludePattern) return false;
	}

	// If exclude rules are specified, event must not match any
	if (rules.exclude.length > 0) {
		const matchesExclude = rules.exclude.some((keyword) => summary.toLowerCase().includes(keyword.toLowerCase()));
		if (matchesExclude) return false;
	}

	// If excludePatterns are specified, event must not match any
	if (rules.excludePatterns.length > 0) {
		const matchesExcludePattern = rules.excludePatterns.some((pattern) => pattern.test(summary));
		if (matchesExcludePattern) return false;
	}

	return true;
}

// Main filtering function
function filterICalendar(icalText: string, rules: FilterRules) {
	const lines = icalText.split('\n');
	const events = parseICalendar(icalText);

	// Filter events
	const filteredEvents = events.filter((event) => shouldIncludeEvent(event, rules));

	// Rebuild iCalendar
	const header = [];
	const footer = [];
	let inHeader = true;

	for (const line of lines) {
		if (line.trim() === 'BEGIN:VEVENT') {
			inHeader = false;
			break;
		}
		if (inHeader) {
			header.push(line);
		}
	}

	// Find footer (everything after last END:VEVENT)
	let lastEventEnd = -1;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].trim() === 'END:VEVENT') {
			lastEventEnd = i;
			break;
		}
	}

	if (lastEventEnd >= 0) {
		for (let i = lastEventEnd + 1; i < lines.length; i++) {
			footer.push(lines[i]);
		}
	}

	// Combine header + filtered events + footer
	const result = [...header, ...filteredEvents.flatMap((event) => event.raw), ...footer].join('\n');

	return result;
}

// Usage examples:
//
// Basic usage with target calendar (URL encoded):
// https://your-worker.your-subdomain.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123
//
// Filter out Secondary OnCall events:
// https://your-worker.your-subdomain.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&exclude=Secondary
//
// Only show Primary OnCall events:
// https://your-worker.your-subdomain.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&include=Primary
//
// Filter using regex patterns:
// https://your-worker.your-subdomain.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&excludePattern=Secondary.*OnCall
//
// Complex filtering (only TeamA events, exclude Secondary):
// https://your-worker.your-subdomain.workers.dev/?targetCalendar=webcal%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123&include=TeamA&exclude=Secondary
//
// JavaScript example for URL encoding:
// const targetCalendar = 'webcal://company.pagerduty.com/feed/abc123';
// const encodedUrl = encodeURIComponent(targetCalendar);
// const fullUrl = `https://your-worker.your-subdomain.workers.dev/?targetCalendar=${encodedUrl}`;
//
// You can also use https:// URLs directly:
// https://your-worker.your-subdomain.workers.dev/?targetCalendar=https%3A%2F%2Fcompany.pagerduty.com%2Ffeed%2Fabc123
