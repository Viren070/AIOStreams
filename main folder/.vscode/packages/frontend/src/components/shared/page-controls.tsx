import { Button } from '../ui/button';
import { useMenu } from '@/context/menu';
import { FaArrowLeft, FaArrowRight } from 'react-icons/fa6';

export function PageControls() {
  const {
    setSelectedMenu,
    selectedMenu,
    previousMenu,
    nextMenu,
    firstMenu,
    lastMenu,
  } = useMenu();

  return (
    <div className="flex flex-1 gap-4">
      <Button
        leftIcon={<FaArrowLeft />}
        intent="white"
        size="md"
        hideTextOnSmallScreen
        rounded
        className="min-w-[60px] md:min-w-[120px]"
        onClick={() => {
          previousMenu();
        }}
        onMouseDown={(e) => {
          // Only handle left click
          if (e.button === 0) {
            const timeout = setTimeout(() => {
              // firstMenu();
              setSelectedMenu(firstMenu);
            }, 500);
            // Cleanup timeout on mouse up
            const cleanup = () => {
              clearTimeout(timeout);
              window.removeEventListener('mouseup', cleanup);
            };
            window.addEventListener('mouseup', cleanup);
          }
        }}
        disabled={selectedMenu === firstMenu}
      >
        Previous
      </Button>
      <Button
        rightIcon={<FaArrowRight />}
        intent="white"
        size="md"
        hideTextOnSmallScreen
        rounded
        className="min-w-[60px] md:min-w-[120px]"
        onClick={() => {
          nextMenu();
        }}
        onMouseDown={(e) => {
          // Only handle left click
          if (e.button === 0) {
            const timeout = setTimeout(() => {
              setSelectedMenu(lastMenu);
            }, 500);
            // Cleanup timeout on mouse up
            const cleanup = () => {
              clearTimeout(timeout);
              window.removeEventListener('mouseup', cleanup);
            };
            window.addEventListener('mouseup', cleanup);
          }
        }}
        disabled={selectedMenu === lastMenu}
      >
        Next
      </Button>
    </div>
  );
}
