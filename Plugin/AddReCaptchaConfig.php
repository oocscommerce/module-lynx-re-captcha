<?php
/**
 * Copyright © OOCS Commerce (https://www.oocscommerce.com). All rights reserved.
 * See LICENSE.txt for license details.
 */
declare(strict_types=1);

namespace OOCS\LynxReCaptcha\Plugin;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\ReCaptchaUi\Model\CaptchaTypeResolverInterface;
use Magento\ReCaptchaUi\Model\ErrorMessageConfigInterface;
use Magento\ReCaptchaUi\Model\IsCaptchaEnabledInterface;
use Magento\ReCaptchaUi\Model\UiConfigResolverInterface;
use Magento\Store\Model\ScopeInterface;
use OOCS\LynxTheme\ViewModel\StoreConfig;

/**
 * Adds the storefront reCAPTCHA settings to the store config the client reads: one entry per protected form,
 * the same resolvers core's predispatch observers use, after build() so it is cached with the rest
 */
class AddReCaptchaConfig
{
    private const XML_PATH_TYPE_FOR = 'recaptcha_frontend/type_for';
    private const PAGE_COMPONENT = 'OOCS_LynxReCaptcha/Components/ReCaptcha';

    /**
     * Scope config, is captcha enabled, captcha type resolver, ui config resolver, error message config
     *
     * @param ScopeConfigInterface $scopeConfig
     * @param IsCaptchaEnabledInterface $isCaptchaEnabled
     * @param CaptchaTypeResolverInterface $captchaTypeResolver
     * @param UiConfigResolverInterface $uiConfigResolver
     * @param ErrorMessageConfigInterface $errorMessageConfig
     */
    public function __construct(
        private readonly ScopeConfigInterface $scopeConfig,
        private readonly IsCaptchaEnabledInterface $isCaptchaEnabled,
        private readonly CaptchaTypeResolverInterface $captchaTypeResolver,
        private readonly UiConfigResolverInterface $uiConfigResolver,
        private readonly ErrorMessageConfigInterface $errorMessageConfig,
    ) {
    }

    /**
     * Adds the `recaptcha` section and the ReCaptcha page component when a form is protected
     *
     * @param StoreConfig $subject
     * @param array $result
     * @return array
     * @SuppressWarnings(PHPMD.UnusedFormalParameter)
     */
    public function afterBuild(StoreConfig $subject, array $result): array
    {
        $forms = [];
        $types = [];
        $typeFor = (array) $this->scopeConfig->getValue(self::XML_PATH_TYPE_FOR, ScopeInterface::SCOPE_WEBSITE);
        foreach (array_keys($typeFor) as $key) {
            if (!$this->isCaptchaEnabled->isCaptchaEnabledFor($key)) {
                continue;
            }
            $type = $this->captchaTypeResolver->getCaptchaTypeFor($key);
            $forms[$key] = $type;
            $types[$type] ??= $this->uiConfigResolver->get($key);
        }

        $result['recaptcha'] = [
            'failureMessage' => $this->errorMessageConfig->getValidationFailureMessage(),
            'types' => $types,
            'forms' => $forms,
        ];
        if ($forms) {
            $result['pageComponents'][] = self::PAGE_COMPONENT;
        }

        return $result;
    }
}
