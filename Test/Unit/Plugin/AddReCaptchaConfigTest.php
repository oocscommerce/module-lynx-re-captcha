<?php
/**
 * Copyright © OOCS Commerce (https://www.oocscommerce.com). All rights reserved.
 * See LICENSE.txt for license details.
 */
declare(strict_types=1);

namespace OOCS\LynxReCaptcha\Test\Unit\Plugin;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\ReCaptchaUi\Model\CaptchaTypeResolverInterface;
use Magento\ReCaptchaUi\Model\ErrorMessageConfigInterface;
use Magento\ReCaptchaUi\Model\IsCaptchaEnabledInterface;
use Magento\ReCaptchaUi\Model\UiConfigResolverInterface;
use OOCS\LynxReCaptcha\Plugin\AddReCaptchaConfig;
use OOCS\LynxTheme\ViewModel\StoreConfig;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The reCAPTCHA part of the store config: protected forms, each type's widget config once, the page component
 */
class AddReCaptchaConfigTest extends TestCase
{
    /**
     * @var UiConfigResolverInterface&MockObject
     */
    private UiConfigResolverInterface $uiConfig;

    /**
     * The plugin over these form types, of which the enabled ones are listed
     *
     * @param array $typeFor form key => type, as recaptcha_frontend/type_for holds them
     * @param string[] $enabled
     * @return AddReCaptchaConfig
     */
    private function plugin(array $typeFor, array $enabled): AddReCaptchaConfig
    {
        $scopeConfig = $this->createMock(ScopeConfigInterface::class);
        $scopeConfig->method('getValue')->with('recaptcha_frontend/type_for', 'website')->willReturn($typeFor);
        $isEnabled = $this->createMock(IsCaptchaEnabledInterface::class);
        $isEnabled->method('isCaptchaEnabledFor')->willReturnCallback(fn ($key) => \in_array($key, $enabled, true));
        $typeResolver = $this->createMock(CaptchaTypeResolverInterface::class);
        $typeResolver->method('getCaptchaTypeFor')->willReturnCallback(fn ($key) => $typeFor[$key]);
        $this->uiConfig = $this->createMock(UiConfigResolverInterface::class);
        $this->uiConfig->method('get')->willReturnCallback(fn ($key) => ['sitekey' => 'key-' . $key]);
        $errors = $this->createMock(ErrorMessageConfigInterface::class);
        $errors->method('getValidationFailureMessage')->willReturn('reCAPTCHA verification failed.');

        return new AddReCaptchaConfig($scopeConfig, $isEnabled, $typeResolver, $this->uiConfig, $errors);
    }

    /**
     * Enabled forms are listed with their type; each type's config is read once; the component is added
     *
     * @return void
     */
    public function testEnabledForms(): void
    {
        $typeFor = [
            'customer_login' => 'invisible',
            'contact'        => 'invisible',
            'newsletter'     => 'recaptcha_v3',
            'sendfriend'     => null,
        ];
        $plugin = $this->plugin($typeFor, ['customer_login', 'contact', 'newsletter']);
        $this->uiConfig->expects($this->exactly(2))->method('get');

        $result = $plugin->afterBuild($this->createMock(StoreConfig::class), ['pageComponents' => ['Other/Page']]);

        $this->assertSame([
            'failureMessage' => 'reCAPTCHA verification failed.',
            'types'          => [
                'invisible'    => ['sitekey' => 'key-customer_login'],
                'recaptcha_v3' => ['sitekey' => 'key-newsletter'],
            ],
            'forms'          => [
                'customer_login' => 'invisible',
                'contact'        => 'invisible',
                'newsletter'     => 'recaptcha_v3',
            ],
        ], $result['recaptcha']);
        $this->assertSame(['Other/Page', 'OOCS_LynxReCaptcha/Components/ReCaptcha'], $result['pageComponents']);
    }

    /**
     * With no form protected the config is empty and no component loads
     *
     * @return void
     */
    public function testNothingEnabled(): void
    {
        $result = $this->plugin(['customer_login' => null], [])
            ->afterBuild($this->createMock(StoreConfig::class), ['currencyCode' => 'USD']);

        $this->assertSame(
            ['failureMessage' => 'reCAPTCHA verification failed.', 'types' => [], 'forms' => []],
            $result['recaptcha']
        );
        $this->assertArrayNotHasKey('pageComponents', $result);
        $this->assertSame('USD', $result['currencyCode']);
    }

    /**
     * No type_for config at all is the same as nothing enabled
     *
     * @return void
     */
    public function testNoConfig(): void
    {
        $scopeConfig = $this->createMock(ScopeConfigInterface::class);
        $scopeConfig->method('getValue')->willReturn(null);
        $errors = $this->createMock(ErrorMessageConfigInterface::class);
        $errors->method('getValidationFailureMessage')->willReturn('');
        $plugin = new AddReCaptchaConfig(
            $scopeConfig,
            $this->createMock(IsCaptchaEnabledInterface::class),
            $this->createMock(CaptchaTypeResolverInterface::class),
            $this->createMock(UiConfigResolverInterface::class),
            $errors
        );

        $this->assertSame([], $plugin->afterBuild($this->createMock(StoreConfig::class), [])['recaptcha']['forms']);
    }
}
