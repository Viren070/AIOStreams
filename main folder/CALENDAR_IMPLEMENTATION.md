# Calendar Functionality Implementation

## Overview
The calendar functionality has been implemented to match the official Stremio calendar system at `/calendar/year/month` format. This provides users with a comprehensive calendar view of upcoming movies and TV episodes organized by date.

## Features Implemented

### 1. Calendar Route Handler
- **Route**: `/calendar/:year/:month`
- **Purpose**: Matches official Stremio calendar implementation
- **Location**: `packages/server/src/routes/stremio/calendar.ts`

### 2. Calendar Data Organization
- **Date-based Organization**: Items organized by day, month, and year
- **Monthly View**: Complete month view with navigation
- **Library Integration**: Uses user's library items when available
- **Fallback Content**: Shows popular TMDB content when library is empty

### 3. TMDB Calendar Support
- **Movies**: Upcoming movie releases
- **TV Shows**: Airing episodes and premieres  
- **Collections**: Support for movie collections with logos
- **API Integration**: Full TMDB API integration with proper rate limiting

### 4. Notification Support
- **Episode Notifications**: "Receive notifications for new episodes" toggle
- **TV Series Focus**: Notifications specifically for TV series episodes
- **Status Tracking**: Notification status (pending, sent, failed)
- **Query Parameter**: `?notifications=true` to enable

### 5. Calendar Navigation
- **Month Navigation**: Previous/next month navigation
- **Year Support**: Multi-year calendar support
- **Today Highlighting**: Current day highlighting in calendar view
- **Week Structure**: Proper week day structure (Sunday=0, Monday=1, etc.)

## API Endpoints

### Calendar Endpoint
```
GET /stremio/:uuid/:encryptedPassword/calendar/:year/:month
```

**Parameters:**
- `year`: Calendar year (e.g., 2025)
- `month`: Calendar month (1-12)
- `notifications`: Optional query parameter to enable notifications

**Example:**
```
GET /stremio/user123/pass456/calendar/2025/7?notifications=true
```

### Calendar Catalog (Legacy)
```
GET /stremio/:uuid/:encryptedPassword/catalog/other/tmdb.calendar/year=2025&month=7&notifications=true.json
```

## Implementation Details

### Core Files Modified
1. **`tmdbCalendar.ts`**: Calendar data fetching and organization
2. **`calendar.ts`**: New calendar route handler  
3. **`app.ts`**: Calendar route registration
4. **`main.ts`**: Calendar catalog handling
5. **`tmdb.ts`**: TMDB preset with calendar support

### Calendar Data Structure
```typescript
interface CalendarItem {
  date: {
    day: number;
    month: number; 
    year: number;
  };
  metaItem: MetaPreview;
  video?: {
    id: string;
    title?: string;
    released?: string;
    season?: number;
    episode?: number;
  };
  notificationEnabled?: boolean;
  notificationStatus?: 'pending' | 'sent' | 'failed';
}
```

### Calendar Response
```typescript
interface CalendarResponse {
  items: CalendarItem[];
  monthInfo: {
    today?: number;
    days: number;
    firstWeekday: number;
  };
  selectable: {
    prev: { month: number; year: number };
    next: { month: number; year: number };
  };
  notificationSettings?: {
    enabled: boolean;
    episodeNotifications: boolean;
  };
}
```

## Usage

### Basic Calendar Access
Navigate to calendar view in Stremio:
- Calendar will automatically show current month
- Use navigation arrows to browse different months
- Click on items to view details

### Enable Episode Notifications
1. Access calendar with notifications parameter
2. Toggle will appear for TV series episodes
3. Notifications will be tracked and managed

### Integration with Library
- Calendar automatically uses user's library items
- Shows personalized upcoming episodes and releases
- Fallback to popular content when library is empty

## Compatibility
- **Stremio Official**: Matches official calendar behavior
- **Cinemata**: Similar functionality to cinemata calendar
- **Mobile/Desktop**: Works on all Stremio platforms
- **API Versioning**: Compatible with Stremio addon API

## Future Enhancements
- Push notification delivery system
- Calendar export/sync capabilities
- Customizable notification preferences
- Advanced filtering and search
- Integration with external calendar services
