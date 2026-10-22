import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type Phaser from 'phaser';

/**
 * Android app lifecycle. Going to the background pauses the game; coming
 * back resumes it where it was. The back button never quits the app: it is
 * passed to the game as a 'back' event for the open screen to handle.
 */
export function hookPlatform(game: Phaser.Game): void {
  const sleep = (): void => game.loop.sleep();
  const wake = (): void => game.loop.wake();
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()));
  if (!Capacitor.isNativePlatform()) return;
  void App.addListener('appStateChange', ({ isActive }) => (isActive ? wake() : sleep()));
  void App.addListener('backButton', () => game.events.emit('back'));
}
