import {
  isDevMode,
  saveDevCredential,
  getDevCredential,
  hasDevCredential,
  clearDevCredentials,
  saveDevModel,
  getDevModels,
  getDevModel,
  hasDevModel,
  deleteDevModel,
  clearDevModels,
} from '../../src/core/services/devCredentials';

describe('devCredentials', () => {
  beforeEach(() => {
    // Clear sessionStorage before each test
    sessionStorage.clear();
    // Clear any DEV_MODE env setting
    delete (window as any).__RUNTIME_CONFIG__;
  });

  describe('isDevMode', () => {
    it('should return false when DEV_MODE is not set', () => {
      expect(isDevMode()).toBe(false);
    });

    it('should return true when DEV_MODE is "true"', () => {
      (window as any).__RUNTIME_CONFIG__ = { DEV_MODE: 'true' };
      expect(isDevMode()).toBe(true);
    });

    it('should return false when DEV_MODE is "false"', () => {
      (window as any).__RUNTIME_CONFIG__ = { DEV_MODE: 'false' };
      expect(isDevMode()).toBe(false);
    });
  });

  describe('DevCredentials Management', () => {
    describe('saveDevCredential', () => {
      it('should save credential to sessionStorage', () => {
        saveDevCredential('openai', 'sk-test123');

        const stored = sessionStorage.getItem('ai_dev_credentials');
        expect(stored).toBeTruthy();

        const parsed = JSON.parse(stored!);
        expect(parsed.openai).toBe('sk-test123');
      });

      it('should preserve existing credentials when adding new ones', () => {
        saveDevCredential('openai', 'sk-openai');
        saveDevCredential('anthropic', 'sk-ant-test');

        const stored = JSON.parse(sessionStorage.getItem('ai_dev_credentials')!);
        expect(stored.openai).toBe('sk-openai');
        expect(stored.anthropic).toBe('sk-ant-test');
      });
    });

    describe('getDevCredential', () => {
      it('should retrieve saved credential', () => {
        saveDevCredential('openai', 'sk-test123');
        expect(getDevCredential('openai')).toBe('sk-test123');
      });

      it('should return null for non-existent credential', () => {
        expect(getDevCredential('nonexistent')).toBeNull();
      });

      it('should handle corrupted storage gracefully', () => {
        sessionStorage.setItem('ai_dev_credentials', 'invalid json');
        expect(getDevCredential('openai')).toBeNull();
      });
    });

    describe('hasDevCredential', () => {
      it('should return true if credential exists', () => {
        saveDevCredential('openai', 'sk-test');
        expect(hasDevCredential('openai')).toBe(true);
      });

      it('should return false if credential does not exist', () => {
        expect(hasDevCredential('openai')).toBe(false);
      });
    });

    describe('clearDevCredentials', () => {
      it('should clear all credentials', () => {
        saveDevCredential('openai', 'sk-openai');
        saveDevCredential('anthropic', 'sk-ant');

        clearDevCredentials();

        expect(hasDevCredential('openai')).toBe(false);
        expect(hasDevCredential('anthropic')).toBe(false);
      });
    });
  });

  describe('DevModels Management', () => {
    const sampleModel = {
      name: 'maas/qwen3-14b',
      provider: 'maas',
      modelId: 'qwen3-14b',
      description: 'Test model',
      endpoint: 'https://test.api.com/v1',
      apiKey: 'sk-test123',
      savedAt: '2026-03-08T00:00:00.000Z',
    };

    describe('saveDevModel', () => {
      it('should save model config to sessionStorage', () => {
        saveDevModel(sampleModel);

        const stored = sessionStorage.getItem('ai_dev_models');
        expect(stored).toBeTruthy();

        const parsed = JSON.parse(stored!);
        expect(parsed['maas/qwen3-14b']).toEqual(sampleModel);
      });

      it('should preserve existing models when adding new ones', () => {
        const model1 = { ...sampleModel, name: 'maas/model1', modelId: 'model1' };
        const model2 = { ...sampleModel, name: 'maas/model2', modelId: 'model2' };

        saveDevModel(model1);
        saveDevModel(model2);

        const models = getDevModels();
        expect(models['maas/model1']).toEqual(model1);
        expect(models['maas/model2']).toEqual(model2);
      });

      it('should update existing model if name matches', () => {
        saveDevModel(sampleModel);

        const updatedModel = { ...sampleModel, description: 'Updated description' };
        saveDevModel(updatedModel);

        const model = getDevModel('maas/qwen3-14b');
        expect(model?.description).toBe('Updated description');
      });
    });

    describe('getDevModels', () => {
      it('should retrieve all saved models', () => {
        saveDevModel(sampleModel);
        const models = getDevModels();

        expect(models['maas/qwen3-14b']).toEqual(sampleModel);
      });

      it('should return empty object when no models exist', () => {
        expect(getDevModels()).toEqual({});
      });

      it('should handle corrupted storage gracefully', () => {
        sessionStorage.setItem('ai_dev_models', 'invalid json');
        expect(getDevModels()).toEqual({});
      });
    });

    describe('getDevModel', () => {
      it('should retrieve specific model by name', () => {
        saveDevModel(sampleModel);
        const model = getDevModel('maas/qwen3-14b');

        expect(model).toEqual(sampleModel);
      });

      it('should return null for non-existent model', () => {
        expect(getDevModel('nonexistent')).toBeNull();
      });
    });

    describe('hasDevModel', () => {
      it('should return true if model exists', () => {
        saveDevModel(sampleModel);
        expect(hasDevModel('maas/qwen3-14b')).toBe(true);
      });

      it('should return false if model does not exist', () => {
        expect(hasDevModel('maas/qwen3-14b')).toBe(false);
      });
    });

    describe('deleteDevModel', () => {
      it('should delete specific model', () => {
        const model1 = { ...sampleModel, name: 'maas/model1', modelId: 'model1' };
        const model2 = { ...sampleModel, name: 'maas/model2', modelId: 'model2' };

        saveDevModel(model1);
        saveDevModel(model2);

        deleteDevModel('maas/model1');

        expect(hasDevModel('maas/model1')).toBe(false);
        expect(hasDevModel('maas/model2')).toBe(true);
      });
    });

    describe('clearDevModels', () => {
      it('should clear all models', () => {
        saveDevModel(sampleModel);
        saveDevModel({ ...sampleModel, name: 'maas/another', modelId: 'another' });

        clearDevModels();

        expect(getDevModels()).toEqual({});
      });
    });
  });

  describe('Integration - Credentials and Models', () => {
    it('should handle both credentials and models independently', () => {
      // Save credential
      saveDevCredential('openai', 'sk-test');

      // Save model
      const model = {
        name: 'maas/qwen3-14b',
        provider: 'maas',
        modelId: 'qwen3-14b',
        apiKey: 'sk-maas',
        savedAt: '2026-03-08T00:00:00.000Z',
      };
      saveDevModel(model);

      // Verify both exist independently
      expect(getDevCredential('openai')).toBe('sk-test');
      expect(getDevModel('maas/qwen3-14b')).toEqual(model);

      // Clear credentials shouldn't affect models
      clearDevCredentials();
      expect(getDevCredential('openai')).toBeNull();
      expect(getDevModel('maas/qwen3-14b')).toEqual(model);

      // Clear models shouldn't affect credentials (already cleared above)
      saveDevCredential('anthropic', 'sk-ant');
      clearDevModels();
      expect(getDevCredential('anthropic')).toBe('sk-ant');
      expect(getDevModels()).toEqual({});
    });
  });
});
