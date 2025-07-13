import { Router, Request, Response } from 'express';
import { AIOStreams, CatalogResponse, constants } from '@aiostreams/core';
import { createLogger } from '@aiostreams/core';
import { StremioTransformer } from '@aiostreams/core';

const logger = createLogger('server');
const router = Router();

/**
 * Calendar route handler for official Stremio calendar format
 * Handles /calendar/year/month routes to match official Stremio behavior
 */
router.get(
  '/:year/:month',
  async (req: Request, res: Response<CatalogResponse>, next) => {
    const transformer = new StremioTransformer(req.userData);
    if (!req.userData) {
      res.status(200).json(
        transformer.transformCatalog({
          success: false,
          data: [],
          errors: [{ description: 'Please configure the addon first' }],
        })
      );
      return;
    }

    try {
      const { year, month } = req.params;
      const yearNum = parseInt(year);
      const monthNum = parseInt(month);

      // Validate year and month
      if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
        res.status(400).json(
          transformer.transformCatalog({
            success: false,
            data: [],
            errors: [{ description: 'Invalid year or month format' }],
          })
        );
        return;
      }

      logger.debug('Calendar request received', {
        year: yearNum,
        month: monthNum,
        userData: req.userData,
      });

      // Import calendar functionality
      const { fetchCalendarData } = await import('../../../../../../.vscode/packages/core/src/utils/tmdbCalendar');
      
      // Check for notification settings in query parameters
      const enableNotifications = req.query.notifications === 'true';
      
      // Get calendar data for the specific year/month
      const calendarData = await fetchCalendarData(yearNum, monthNum, undefined, enableNotifications);
      
      // Transform calendar data to catalog format
      const catalogItems = calendarData.items.map(item => ({
        ...item.metaItem,
        // Add calendar-specific metadata
        releaseDate: item.video?.released || item.metaItem.releaseInfo,
        calendarDay: item.date.day,
        calendarMonth: item.date.month,
        calendarYear: item.date.year,
        // Add calendar navigation info
        monthInfo: calendarData.monthInfo,
        selectable: calendarData.selectable,
      }));

      res.status(200).json(
        transformer.transformCatalog({
          success: true,
          data: catalogItems,
          errors: [],
        })
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errors = [
        {
          description: errorMsg,
        },
      ];
      if (transformer.showError('catalog', errors)) {
        logger.error(`Unexpected error during calendar retrieval: ${errorMsg}`);
        res.status(200).json(
          transformer.transformCatalog({
            success: false,
            data: [],
            errors,
          })
        );
        return;
      }
      next(error);
    }
  }
);

export default router;
