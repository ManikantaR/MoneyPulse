import { LearningService } from '../learning.service';

describe('LearningService', () => {
  let service: LearningService;

  beforeEach(() => {
    service = new LearningService({} as any);
  });

  describe('extractPattern', () => {
    it('should remove store numbers', () => {
      expect(service.extractPattern('WHOLE FOODS MARKET #10234')).toBe(
        'whole foods market',
      );
    });

    it('should remove reference codes', () => {
      expect(service.extractPattern('AMAZON.COM*M44KL2')).toBe('amazon.com');
    });

    it('should remove trailing long numbers', () => {
      expect(service.extractPattern('STARBUCKS STORE 12345')).toBe(
        'starbucks',
      );
    });

    it('should limit to 3 words', () => {
      expect(
        service.extractPattern('VERY LONG MERCHANT NAME HERE TODAY'),
      ).toBe('very long merchant');
    });

    it('should handle simple descriptions', () => {
      expect(service.extractPattern('NETFLIX')).toBe('netflix');
    });
  });
});
