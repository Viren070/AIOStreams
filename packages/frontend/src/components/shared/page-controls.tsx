import { Button, IconButton } from '../ui/button';
import { useMenu } from '@/context/menu';
import { FaArrowLeft, FaArrowRight } from 'react-icons/fa6';
import { BiSave } from 'react-icons/bi';
import { useSave } from '@/context/save';
import { useUserData } from '@/context/userData';
import React from 'react';

interface PageControlsProps {
  middleContent?: React.ReactNode;
}

export function PageControls({ middleContent }: PageControlsProps) {
  const {
    setSelectedMenu,
    selectedMenu,
    previousMenu,
    nextMenu,
    firstMenu,
    lastMenu,
  } = useMenu();
  const { handleSave, loading: saveLoading } = useSave();
  const { uuid, password } = useUserData();
  const isLoggedIn = !!(uuid && password);

  return (
    <div className="flex flex-1 gap-2 items-center">
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
      {middleContent}
      {isLoggedIn && (
        <IconButton
          icon={<BiSave />}
          intent="white-outline"
          rounded
          size="md"
          loading={saveLoading}
          onClick={() => handleSave()}
        />
      )}
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
