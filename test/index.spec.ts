import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';

// Mock fetch for testing
const mockFetch = vi.fn();
// @ts-ignore - TypeScript doesn't know about global fetch in test environment
globalThis.fetch = mockFetch;

// Sample iCal data for testing
const sampleICalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event1@test.com
DTSTART:20240101T120000Z
DTEND:20240101T130000Z
SUMMARY:Primary OnCall - TeamA
END:VEVENT
BEGIN:VEVENT
UID:event2@test.com
DTSTART:20240102T120000Z
DTEND:20240102T130000Z
SUMMARY:Secondary OnCall - TeamB
END:VEVENT
BEGIN:VEVENT
UID:event3@test.com
DTSTART:20240103T120000Z
DTEND:20240103T130000Z
SUMMARY:BaaS Team Meeting
END:VEVENT
END:VCALENDAR`;

const emptyICalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
END:VCALENDAR`;

describe('Calendar Filter Worker', () => {
	beforeEach(() => {
		mockFetch.mockReset();
	});

	describe('Main fetch handler', () => {
		it('returns 400 when targetCalendar parameter is missing', async () => {
			const request = new Request('https://example.com');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.text()).toBe('Missing targetCalendar parameter. Usage: ?targetCalendar=webcal://your-calendar-url');
		});

		it('returns 400 when targetCalendar parameter is invalid (wrong protocol)', async () => {
			const request = new Request('https://example.com?targetCalendar=http%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.text()).toBe('Invalid calendar URL. Must be a valid webcal:// or https:// URL');
		});

		it('returns 400 when targetCalendar parameter is malformed URL', async () => {
			const request = new Request('https://example.com?targetCalendar=invalid-url');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			expect(await response.text()).toBe('Invalid calendar URL. Must be a valid webcal:// or https:// URL');
		});

		it('returns 502 when external calendar fetch fails', async () => {
			mockFetch.mockResolvedValueOnce(new Response(null, { status: 404, statusText: 'Not Found' }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(502);
			expect(await response.text()).toBe('Failed to fetch calendar: 404 Not Found');
		});

		it('returns 500 when fetch throws an error', async () => {
			mockFetch.mockRejectedValueOnce(new Error('Network error'));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(500);
			expect(await response.text()).toBe('Error processing calendar feed');
		});

		it('successfully processes calendar with webcal URL', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(response.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
			expect(response.headers.get('Cache-Control')).toBe('max-age=300');
			expect(mockFetch).toHaveBeenCalledWith('https://test.com/calendar');
		});

		it('successfully processes calendar with https URL', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=https%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(mockFetch).toHaveBeenCalledWith('https://test.com/calendar');
		});
	});

	describe('Filter functionality', () => {
		it('filters events by include keyword', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=Primary');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});

		it('filters events by exclude keyword', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&exclude=Secondary');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).toContain('BaaS Team Meeting');
		});

		it('filters events by multiple include keywords', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=Primary,TeamA');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
		});

		it('filters events by multiple exclude keywords', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&exclude=Secondary,BaaS');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});

		it('filters events by include pattern', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&includePattern=Primary.*OnCall');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});

		it('filters events by exclude pattern', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&excludePattern=Secondary.*OnCall');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).toContain('BaaS Team Meeting');
		});

		it('filters events by multiple patterns', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&excludePattern=Secondary.*OnCall,.*Meeting');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});

		it('handles case insensitive keyword matching', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=primary');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
		});

		it('handles combined include and exclude filters', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=OnCall&exclude=Secondary');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});

		it('handles combined keyword and pattern filters', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=OnCall&excludePattern=Secondary.*');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
		});

		it('handles whitespace in filter parameters', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=%20Primary%20,%20TeamA%20');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
		});
	});

	describe('Calendar parsing edge cases', () => {
		it('handles empty calendar', async () => {
			mockFetch.mockResolvedValueOnce(new Response(emptyICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const result = await response.text();
			expect(result).toContain('BEGIN:VCALENDAR');
			expect(result).toContain('END:VCALENDAR');
		});

		it('handles calendar with events with missing properties', async () => {
			const incompleteCalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event1@test.com
END:VEVENT
BEGIN:VEVENT
UID:event2@test.com
SUMMARY:Event with summary only
END:VEVENT
END:VCALENDAR`;

			mockFetch.mockResolvedValueOnce(new Response(incompleteCalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			const result = await response.text();
			expect(result).toContain('Event with summary only');
		});

		it('preserves calendar structure with header and footer', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=Primary');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('BEGIN:VCALENDAR');
			expect(result).toContain('VERSION:2.0');
			expect(result).toContain('PRODID:-//Test//Test//EN');
			expect(result).toContain('END:VCALENDAR');
		});

		it('handles events with undefined/empty summaries in filtering', async () => {
			const edgeCaseCalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:event1@test.com
SUMMARY:
END:VEVENT
BEGIN:VEVENT
UID:event2@test.com
SUMMARY:Primary OnCall - TeamA
END:VEVENT
END:VCALENDAR`;

			mockFetch.mockResolvedValueOnce(new Response(edgeCaseCalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=Primary');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('SUMMARY:\nEND:VEVENT'); // Empty summary event should be excluded
		});
	});

	describe('URL handling edge cases', () => {
		it('handles complex webcal URLs with query parameters', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const complexUrl = 'webcal://test.pagerduty.com/feed/abc123?param=value&other=test';
			const encodedUrl = encodeURIComponent(complexUrl);
			const request = new Request(`https://example.com?targetCalendar=${encodedUrl}`);
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(mockFetch).toHaveBeenCalledWith('https://test.pagerduty.com/feed/abc123?param=value&other=test');
		});

		it('handles webcal URLs that don\'t start with webcal://', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const httpsUrl = 'https://test.pagerduty.com/feed/abc123';
			const encodedUrl = encodeURIComponent(httpsUrl);
			const request = new Request(`https://example.com?targetCalendar=${encodedUrl}`);
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(200);
			expect(mockFetch).toHaveBeenCalledWith('https://test.pagerduty.com/feed/abc123');
		});

		it('validates URL format properly', async () => {
			const invalidUrls = [
				'webcal://invalid url with spaces',
				'not-a-url-at-all',
				'ftp://test.com/calendar',
				'javascript:alert("xss")'
			];

			for (const invalidUrl of invalidUrls) {
				const encodedUrl = encodeURIComponent(invalidUrl);
				const request = new Request(`https://example.com?targetCalendar=${encodedUrl}`);
				const ctx = createExecutionContext();
				const response = await worker.fetch(request, env, ctx);
				await waitOnExecutionContext(ctx);

				expect(response.status).toBe(400);
			}
		});
	});

	describe('Filter rules parsing edge cases', () => {
		it('handles no filters (returns all events)', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).toContain('Secondary OnCall - TeamB');
			expect(result).toContain('BaaS Team Meeting');
		});

		it('handles regex pattern with special characters', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			// Test pattern that matches "OnCall - Team" with any character between
			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&includePattern=OnCall.*Team.');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			expect(result).toContain('Primary OnCall - TeamA');
			expect(result).toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});

		it('handles include rules that require at least one match', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&include=NonExistentTerm');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			// Should not contain any events since none match the include term
			expect(result).not.toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});

		it('handles include patterns that require at least one match', async () => {
			mockFetch.mockResolvedValueOnce(new Response(sampleICalData, { status: 200 }));

			const request = new Request('https://example.com?targetCalendar=webcal%3A%2F%2Ftest.com%2Fcalendar&includePattern=NonExistent.*Pattern');
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			const result = await response.text();
			// Should not contain any events since none match the include pattern
			expect(result).not.toContain('Primary OnCall - TeamA');
			expect(result).not.toContain('Secondary OnCall - TeamB');
			expect(result).not.toContain('BaaS Team Meeting');
		});
	});
});
