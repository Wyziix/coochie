import { compressPhoto } from '@/lib/images/compress';

const mockResize = jest.fn();
const mockSaveAsync = jest.fn(async () => ({
  uri: 'file:///small.jpg',
  width: 1200,
  height: 1600,
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: () => {
      const ctx = {
        resize: (s: unknown) => (mockResize(s), ctx),
        renderAsync: async () => ({ saveAsync: mockSaveAsync }),
      };
      return ctx;
    },
  },
}));

describe('compressPhoto', () => {
  beforeEach(() => jest.clearAllMocks());

  it('scales the long side down to 1600 px and saves a JPEG', async () => {
    const out = await compressPhoto({ uri: 'file:///big.heic', width: 3024, height: 4032 });
    expect(mockResize).toHaveBeenCalledWith({ height: 1600 });
    expect(mockSaveAsync).toHaveBeenCalledWith({ compress: 0.75, format: 'jpeg' });
    expect(out).toEqual({ uri: 'file:///small.jpg', width: 1200, height: 1600 });
  });

  it('only re-encodes a photo that is already small', async () => {
    await compressPhoto({ uri: 'file:///small.png', width: 800, height: 600 });
    expect(mockResize).not.toHaveBeenCalled();
    expect(mockSaveAsync).toHaveBeenCalled();
  });
});
